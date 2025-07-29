const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("worker_threads");

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { getPathValidator } = require("./src/security/path-validator.cjs");
const { ipcValidator } = require("./src/validation/ipc-validator.js");

// Add handling for the 'ignore' module
let ignore;
// Global cancellation flag for file loading
let fileLoadingCancelled = false;

// Track current workspace paths for security validation
let currentWorkspacePaths = [];

try {
  ignore = require("ignore");
  console.log("Successfully loaded ignore module");
} catch (error) {
  console.error("Failed to load ignore module:", error);
  // Simple fallback implementation for when the ignore module fails to load
  ignore = {
    // Simple implementation that just matches exact paths
    createFilter: () => {
      return (path) => !excludedFiles.includes(path);
    },
  };
  console.log("Using fallback for ignore module");
}

// Initialize tokenizer with better error handling
let tiktoken;
try {
  tiktoken = require("tiktoken");
  console.log("Successfully loaded tiktoken module");
} catch (error) {
  console.error("Failed to load tiktoken module:", error);
  tiktoken = null;
}

// Import the excluded files list
const { excludedFiles, binaryExtensions } = require("./excluded-files");

// Initialize the encoder once at startup with better error handling
let encoder;
try {
  if (tiktoken) {
    encoder = tiktoken.get_encoding("o200k_base"); // gpt-4o encoding
    console.log("Tiktoken encoder initialized successfully");
  } else {
    throw new Error("Tiktoken module not available");
  }
} catch (error) {
  console.error("Failed to initialize tiktoken encoder:", error);
  // Fallback to a simpler method if tiktoken fails
  console.log("Using fallback token counter");
  encoder = null;
}

// Binary file extensions that should be excluded from token counting
const BINARY_EXTENSIONS = new Set([
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".ico",
  ".webp",
  ".svg",
  // Audio/Video
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  // Archives
  ".zip",
  ".rar",
  ".tar",
  ".gz",
  ".7z",
  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  // Compiled
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".o",
  ".pyc",
  // Database
  ".db",
  ".sqlite",
  ".sqlite3",
  // Others
  ".bin",
  ".dat",
  ".lockb",
  ...(binaryExtensions || []) // Add any additional binary extensions from excluded-files.js
]);

// Max file size to read (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Special file extensions to skip (not even try to read)
const SPECIAL_FILE_EXTENSIONS = new Set(['.asar', '.bin', '.dll', '.exe', '.so', '.dylib']);

// Function to check if a character is likely a binary/control character
function isControlOrBinaryChar(codePoint) {
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    codePoint === 11 || // VT
    codePoint === 12 || // FF
    (codePoint >= 14 && codePoint <= 31) ||
    codePoint === 127 || // DEL
    (codePoint >= 128 && codePoint <= 255) // Extended ASCII
  );
}

// Function to check if content is likely binary (has many control characters)
function isLikelyBinaryContent(content, filePath) {
  // Skip binary content check for JavaScript files
  if (filePath && path.extname(filePath).toLowerCase() === '.js') {
    return false;
  }
  
  // Count control/binary characters
  let controlCharCount = 0;
  const threshold = 50; // Same as the original regex threshold
  
  for (let i = 0; i < content.length; i++) {
    if (isControlOrBinaryChar(content.codePointAt(i))) {
      controlCharCount++;
      if (controlCharCount >= threshold) {
        return true;
      }
    }
  }
  
  // Also check for special tokens
  return content.includes("<|endoftext|>");
}

// Function to check if file has special extension that should be skipped
function isSpecialFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SPECIAL_FILE_EXTENSIONS.has(ext);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      devTools: {
        // Add these settings to prevent Autofill warnings
        isDevToolsExtension: false,
        htmlFullscreen: false,
      },
    },
  });

  // Set Content Security Policy for Web Workers and WASM
  const isDev = process.env.NODE_ENV === "development";
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev 
      ? "default-src 'self';" +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: http://localhost:*;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self' http://localhost:* ws://localhost:*;" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;"
      : "default-src 'self';" +
        "script-src 'self' 'wasm-unsafe-eval' blob:;" +
        "worker-src 'self' blob:;" +
        "connect-src 'self';" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' data: blob:;" +
        "font-src 'self' data:;";
    
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  // In development, load from Vite dev server
  // In production, load from built files
  if (isDev) {
    // Use the URL provided by the dev script, or fall back to default
    const startUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";
    // Wait a moment for dev server to be ready
    setTimeout(() => {
      // Clear any cached data to prevent redirection loops
      mainWindow.webContents.session.clearCache().then(() => {
        mainWindow.loadURL(startUrl);
        // Open DevTools in development mode with options to reduce warnings
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        }
        mainWindow.webContents.openDevTools({ mode: "detach" });
        console.log(`Loading from dev server at ${startUrl}`);
      });
    }, 1000);
  } else {
    const indexPath = path.join(__dirname, "dist", "index.html");
    console.log(`Loading from built files at ${indexPath}`);

    // Use loadURL with file protocol for better path resolution
    const indexUrl = `file://${indexPath}`;
    mainWindow.loadURL(indexUrl);
  }

  // Add basic error handling for failed loads
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Failed to load the application: ${errorDescription} (${errorCode})`,
      );
      console.error(`Attempted to load URL: ${validatedURL}`);

      if (isDev) {
        const retryUrl =
          process.env.ELECTRON_START_URL || "http://localhost:3000";
        // Clear cache before retrying
        mainWindow.webContents.session.clearCache().then(() => {
          setTimeout(() => mainWindow.loadURL(retryUrl), 1000);
        });
      } else {
        // Retry with explicit file URL
        const indexPath = path.join(__dirname, "dist", "index.html");
        const indexUrl = `file://${indexPath}`;
        mainWindow.loadURL(indexUrl);
      }
    },
  );
}

// Replace the top-level await with a proper async function
// eslint-disable-next-line unicorn/prefer-top-level-await
app.whenReady().then(() => {
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle folder selection
ipcMain.on("open-folder", async (event) => {
  // SECURITY: Apply rate limiting
  const validation = ipcValidator.validate('open-folder', {}, event);
  
  if (!validation.success) {
    console.warn(`Rate limit exceeded for open-folder from sender: ${event.sender.id}`);
    return;
  }
  
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    try {
      // Ensure we're only sending a string, not an object
      const pathString = String(selectedPath);
      
      // Update workspace paths for security validation
      currentWorkspacePaths = [pathString];
      getPathValidator(currentWorkspacePaths);
      
      console.log("Sending folder-selected event with path:", pathString);
      event.sender.send("folder-selected", pathString);
    } catch (error) {
      console.error("Error sending folder-selected event:", error);
      // Try a more direct approach as a fallback
      event.sender.send("folder-selected", String(selectedPath));
    }
  }
});

// Function to parse .gitignore file if it exists
function loadGitignore(rootDir, userExclusionPatterns = []) {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    ig.add(gitignoreContent);
  }

  // Add some default ignores that are common
  ig.add([".git", "node_modules", ".DS_Store"]);

  // Add the excludedFiles patterns for gitignore-based exclusion
  ig.add(excludedFiles);
  
  // Add user-defined exclusion patterns
  if (userExclusionPatterns && userExclusionPatterns.length > 0) {
    console.log("Adding user exclusion patterns:", userExclusionPatterns);
    ig.add(userExclusionPatterns);
  }

  return ig;
}

// Check if file is binary based on extension
function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext) || isSpecialFile(filePath);
}

// Function to sanitize text for token counting
function sanitizeTextForTokenCount(text) {
  // Remove the problematic token
  let sanitizedText = text.replace(/<\|endoftext\|>/g, "");
  
  // Remove control characters
  let result = "";
  for (let i = 0; i < sanitizedText.length; i++) {
    const codePoint = sanitizedText.codePointAt(i);
    if (!isControlOrBinaryChar(codePoint) || 
        codePoint === 9 ||  // Tab
        codePoint === 10 || // LF
        codePoint === 13) { // CR
      result += sanitizedText[i];
    }
  }
  
  return result;
}

// Count tokens using tiktoken with o200k_base encoding
function countTokens(text) {
  // Simple fallback implementation if encoder fails
  if (!encoder) {
    // Very rough estimate: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  }

  try {
    // Add sanitization to remove problematic tokens that cause tiktoken to fail
    const sanitizedText = sanitizeTextForTokenCount(text);
    
    // If the sanitization removed a significant portion of the text, fall back to estimation
    if (sanitizedText.length < text.length * 0.9) {
      console.warn("Text contained many special tokens, using estimation instead");
      return Math.ceil(text.length / 4);
    }
    
    const tokens = encoder.encode(sanitizedText);
    return tokens.length;
  } catch (error) {
    console.error("Error counting tokens:", error);
    // Fallback to character-based estimation on error
    return Math.ceil(text.length / 4);
  }
}

// Function to process a single file - OPTIMIZED VERSION
function processFile(dirent, fullPath, folderPath, fileSize) {
  // Skip files that are too large
  if (fileSize > MAX_FILE_SIZE) {
    return {
      name: dirent.name,
      path: fullPath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      isBinary: false,
      isSkipped: true,
      error: "File too large to process",
      isDirectory: false,
      isContentLoaded: false
    };
  }

  // Check if file has special extension that should be skipped entirely
  if (isSpecialFile(fullPath)) {
    return {
      name: dirent.name,
      path: fullPath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      isBinary: true,
      isSkipped: true,
      fileType: path.extname(fullPath).slice(1).toUpperCase(),
      error: "Special file type skipped",
      isDirectory: false,
      isContentLoaded: false
    };
  }

  // Check if binary - WITHOUT reading the file content!
  const isBinary = isBinaryFile(fullPath);
  
  // Don't read file content during initial scan - just return metadata
  return {
    name: dirent.name,
    path: fullPath,
    tokenCount: 0, // Will be calculated on-demand
    size: fileSize,
    content: "", // Will be loaded on-demand
    isBinary: isBinary,
    isSkipped: false,
    fileType: path.extname(fullPath).slice(1).toUpperCase() || 'TEXT',
    excludedByDefault: shouldExcludeByDefault(fullPath, folderPath),
    isDirectory: false,
    isContentLoaded: false // Mark as not loaded
  };
}

// Function to process a directory
function processDirectory(dirPath, folderPath, depth, ignoreFilter) {
  const results = [];
  try {
    const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const fullPath = path.join(dirPath, dirent.name);
      const relativePath = path.relative(folderPath, fullPath);
      
      if (ignoreFilter.ignores(relativePath)) {
        continue;
      }

      if (dirent.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          results.push(processFile(dirent, fullPath, folderPath, stats.size));
        } catch (error) {
          console.error(`Error processing file ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  return results;
}

// Handle file list request
ipcMain.on("request-file-list", async (event, folderPath, exclusionPatterns = []) => {
  // SECURITY: Validate input parameters
  const validation = ipcValidator.validate('request-file-list', { folderPath, exclusionPatterns }, event);
  
  if (!validation.success) {
    console.warn(`Input validation failed for request-file-list: ${validation.error}`);
    event.sender.send("file-processing-status", {
      status: "error",
      message: validation.error
    });
    return;
  }
  
  const { folderPath: validatedFolderPath, exclusionPatterns: validatedPatterns } = validation.data;
  
  try {
    console.log("Received request for file list in:", validatedFolderPath);
    console.log("Exclusion patterns:", validatedPatterns);
    
    // Update workspace paths for security validation when loading files
    // This ensures the path validator knows about the current workspace
    currentWorkspacePaths = [validatedFolderPath];
    getPathValidator(currentWorkspacePaths);
    
    fileLoadingCancelled = false;

    event.sender.send("file-processing-status", {
      status: "processing",
      message: "Scanning directory structure...",
    });

    const allFiles = [];
    const directoryQueue = [{path: validatedFolderPath, depth: 0}];
    const processedDirs = new Set();
    const ignoreFilter = loadGitignore(validatedFolderPath, validatedPatterns);
    const pendingFiles = []; // Files to process in workers
    const NUM_WORKERS = 4; // Number of worker threads
    let processingComplete = false; // Flag to prevent multiple completion calls
    
    // Send initial batch immediately for fast tree display
    const sendBatch = (files, isComplete = false) => {
      const serializableFiles = files.map(file => ({
        name: file.name || "",
        path: file.path || "",
        tokenCount: file.tokenCount || 0,
        size: file.size || 0,
        content: "", // No content during initial load
        isBinary: Boolean(file.isBinary),
        isSkipped: Boolean(file.isSkipped),
        isDirectory: Boolean(file.isDirectory),
        error: file.error || null,
        fileType: file.fileType || null,
        excludedByDefault: file.excludedByDefault || false,
        isContentLoaded: false
      }));

      event.sender.send("file-list-data", {
        files: serializableFiles,
        isComplete,
        processed: allFiles.length,
        directories: processedDirs.size
      });
    };

    const processNextBatch = async () => {
      if (fileLoadingCancelled) {
        event.sender.send("file-processing-status", {
          status: "idle",
          message: "File loading cancelled",
        });
        return;
      }

      let processedDirsCount = 0;
      const BATCH_SIZE = 50; // Smaller batches for faster initial display
      const MAX_DIRS_PER_BATCH = 10;
      const currentBatchFiles = [];
      
      while (directoryQueue.length > 0 && processedDirsCount < MAX_DIRS_PER_BATCH) {
        directoryQueue.sort((a, b) => a.depth - b.depth);
        const { path: dirPath, depth } = directoryQueue.shift();
        
        if (processedDirs.has(dirPath) || depth > 20) {
          continue;
        }

        processedDirs.add(dirPath);
        processedDirsCount++;

        // Process directory with async operations
        try {
          const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
          
          for (const dirent of dirents) {
            const fullPath = path.join(dirPath, dirent.name);
            const relativePath = path.relative(folderPath, fullPath);
            
            if (ignoreFilter.ignores(relativePath)) {
              continue;
            }

            if (dirent.isDirectory()) {
              directoryQueue.push({ path: fullPath, depth: depth + 1 });
            } else if (dirent.isFile()) {
              // Get file stats asynchronously
              try {
                const stats = await fs.promises.stat(fullPath);
                const fileInfo = processFile(dirent, fullPath, folderPath, stats.size);
                currentBatchFiles.push(fileInfo);
                allFiles.push(fileInfo);
              } catch (error) {
                console.error(`Error processing file ${fullPath}:`, error);
              }
            }
          }
        } catch (error) {
          console.error(`Error reading directory ${dirPath}:`, error);
        }

        // Send batch when we have enough files
        if (currentBatchFiles.length >= BATCH_SIZE) {
          sendBatch(currentBatchFiles, false);
          currentBatchFiles.length = 0; // Clear the batch
        }
      }

      // Send any remaining files in the batch
      if (currentBatchFiles.length > 0) {
        sendBatch(currentBatchFiles, false);
      }

      event.sender.send("file-processing-status", {
        status: "processing",
        message: `Found ${allFiles.length} files... (${processedDirs.size} directories)`,
        processed: allFiles.length,
        directories: processedDirs.size
      });

      if (directoryQueue.length === 0 && !processingComplete) {
        finishProcessing();
      } else if (directoryQueue.length > 0) {
        // Use setTimeout instead of setImmediate to allow garbage collection
        setTimeout(processNextBatch, 0);
      }
    };

    const finishProcessing = () => {
      if (fileLoadingCancelled || processingComplete) {
        return;
      }
      processingComplete = true; // Mark as complete to prevent multiple calls

      event.sender.send("file-processing-status", {
        status: "complete",
        message: `Found ${allFiles.length} files`,
      });

      // Send final complete signal
      sendBatch([], true); // Empty batch with complete flag
      
      console.log(`File scanning complete. Found ${allFiles.length} files in ${processedDirs.size} directories`);
    };

    // Start processing
    processNextBatch();
  } catch (error) {
    console.error("Error reading directory:", error);
    event.sender.send("file-processing-status", {
      status: "error",
      message: "Error reading directory: " + error.message,
    });
  }
});

// Add handler for cancel request
ipcMain.on("cancel-file-loading", () => {
  console.log("Received request to cancel file loading");
  fileLoadingCancelled = true;
});

// Check if a file should be excluded by default, using glob matching
function shouldExcludeByDefault(filePath, rootDir) {
  const relativePath = path.relative(rootDir, filePath);
  const relativePathNormalized = relativePath.replace(/\\/g, "/"); // Normalize for consistent pattern matching

  // Use the ignore package to do glob pattern matching
  const ig = ignore().add(excludedFiles);
  return ig.ignores(relativePathNormalized);
}

// Add a new IPC handler for opening documentation
ipcMain.on('open-docs', (event, docName) => {
  // SECURITY: Validate and sanitize document name to prevent path injection
  if (!docName || typeof docName !== 'string') {
    console.warn('Invalid document name provided to open-docs');
    return;
  }
  
  // Only allow specific document formats and remove any path traversal
  const sanitizedDocName = path.basename(docName);
  if (!/^[a-zA-Z0-9._-]+\.(md|txt|pdf)$/i.test(sanitizedDocName)) {
    console.warn(`Invalid document format requested: ${docName}`);
    return;
  }
  
  // Path to the documentation file - only allow files in docs directory
  const docPath = path.join(__dirname, 'docs', sanitizedDocName);
  
  // Additional security check - ensure resolved path is still within docs directory
  const resolvedDocPath = path.resolve(docPath);
  const docsDir = path.resolve(__dirname, 'docs');
  if (!resolvedDocPath.startsWith(docsDir + path.sep)) {
    console.warn(`Attempted access outside docs directory: ${docName}`);
    return;
  }
  
  // Check if the file exists
  fs.access(resolvedDocPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`Documentation file not found: ${resolvedDocPath}`);
      return;
    }
    
    // Open the file in the default application
    shell.openPath(resolvedDocPath)
      .then(result => {
        if (result) {
          console.error(`Error opening documentation: ${result}`);
        }
      });
  });
});

// Add request-file-content handler for lazy loading file content
ipcMain.handle('request-file-content', async (event, filePath) => {
  // SECURITY: Validate path to prevent path traversal attacks
  // If no workspace paths are set, this might be a file request before folder selection
  // In this case, we should reject the request for security
  if (!currentWorkspacePaths || currentWorkspacePaths.length === 0) {
    console.warn('No workspace paths set - file access denied for security');
    return { success: false, error: 'No workspace selected', reason: 'NO_WORKSPACE' };
  }
  
  
  const validator = getPathValidator(currentWorkspacePaths);
  const validation = validator.validatePath(filePath);
  
  if (!validation.valid) {
    console.warn(`Security violation in request-file-content: ${validation.reason} for path: ${filePath}`);
    return { success: false, error: 'Access denied', reason: validation.reason };
  }
  
  try {
    const content = await fs.promises.readFile(validation.sanitizedPath, 'utf8');
    if (isLikelyBinaryContent(content, filePath)) {
      return { success: false, error: 'File contains binary data', isBinary: true };
    }
    const tokenCount = countTokens(content);
    return { success: true, content, tokenCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
});