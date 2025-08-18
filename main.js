// Ensure Zod uses classic parser in Electron main to avoid eval issues
process.env.ZOD_DISABLE_DOC = process.env.ZOD_DISABLE_DOC || '1';

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("worker_threads");

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");

// Load database bridge - use compiled version in production, TypeScript in development
let DatabaseBridge;
if (process.env.NODE_ENV === 'development') {
  // Register tsx to handle TypeScript files at runtime in development
  require('tsx/cjs');
  DatabaseBridge = require("./src/main/db/database-bridge.ts").DatabaseBridge;
} else {
  // Use compiled JavaScript in production
  DatabaseBridge = require("./build/main/db/database-bridge.js").DatabaseBridge;
}

const { getPathValidator } = require("./src/security/path-validator.cjs");
const { ipcValidator } = require("./src/validation/ipc-validator.js");
// Zod schemas (CommonJS) for main process validation
const zSchemas = require("./lib/main/ipc/schemas.cjs");
// Import centralized constants - moved here from line 209 to be available for createWindow()
const { FILE_PROCESSING, ELECTRON, TOKEN_COUNTING } = require('./src/constants/app-constants.js');

// SecureIpc has been removed - always use legacy handlers


// Add error handling for console operations to prevent EIO errors
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

console.error = (...args) => {
  try {
    originalConsoleError.apply(console, args);
  } catch (err) {
    // Silently ignore EIO errors in console output
    if (err.code !== 'EIO') {
      // Try to write to stderr directly as fallback
      try {
        process.stderr.write(`Console error: ${args.join(' ')}\n`);
      } catch (fallbackErr) {
        // If even stderr fails, just ignore
      }
    }
  }
};

console.warn = (...args) => {
  try {
    originalConsoleWarn.apply(console, args);
  } catch (err) {
    if (err.code !== 'EIO') {
      try {
        process.stderr.write(`Console warn: ${args.join(' ')}\n`);
      } catch (fallbackErr) {
        // If even stderr fails, just ignore
      }
    }
  }
};

console.log = (...args) => {
  try {
    originalConsoleLog.apply(console, args);
  } catch (err) {
    if (err.code !== 'EIO') {
      try {
        process.stdout.write(`Console log: ${args.join(' ')}\n`);
      } catch (fallbackErr) {
        // If even stdout fails, just ignore
      }
    }
  }
};

// Add global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process for EIO errors
  if (error.code === 'EIO') {
    console.log('Ignoring EIO error to prevent crash');
    return;
  }
  // For other errors, log but don't crash in production
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    console.error('Preventing crash in production mode');
    return;
  }
  // In development, still crash for debugging
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't crash for unhandled rejections
});

// Add handling for the 'ignore' module
let ignore;
// Global cancellation flag for file loading
let fileLoadingCancelled = false;
// Track current request ID to ignore stale file batches
let currentRequestId = null;

// Track current workspace paths for security validation
let currentWorkspacePaths = [];

// Store for workspace and preferences data
const workspaceStore = new Map();
const preferencesStore = new Map();

// Database instance
let database = null;

// Main window instance
let mainWindow = null;

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

// Max file size to read (constants already imported at top of file)
const MAX_FILE_SIZE = FILE_PROCESSING.MAX_FILE_SIZE_BYTES;

// Special file extensions to skip (not even try to read)
const SPECIAL_FILE_EXTENSIONS = new Set(['.asar', '.bin', '.dll', '.exe', '.so', '.dylib']);

// Function to check if a character is likely a binary/control character
function isControlOrBinaryChar(codePoint) {
  // Treat only non-whitespace ASCII control chars as binary; allow all Unicode >= 128
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    codePoint === 11 || // VT
    codePoint === 12 || // FF
    (codePoint >= 14 && codePoint <= 31) ||
    codePoint === 127 // DEL
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
  const threshold = ELECTRON.BINARY_DETECTION.CONTROL_CHAR_THRESHOLD;

  for (let i = 0; i < content.length; i++) {
    if (isControlOrBinaryChar(content.codePointAt(i))) {
      controlCharCount++;
      if (controlCharCount >= threshold) {
        return true;
      }
    }
  }

  return false;
}

// Function to check if file has special extension that should be skipped
function isSpecialFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SPECIAL_FILE_EXTENSIONS.has(ext);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: ELECTRON.WINDOW.WIDTH,
    height: ELECTRON.WINDOW.HEIGHT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      // Note: devTools is controlled via webContents.openDevTools(), not here
      // The Autofill warnings are harmless and come from Chrome DevTools
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
    const startUrl = process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
    // Wait a moment for dev server to be ready
    setTimeout(() => {
      // Clear any cached data to prevent redirection loops
      mainWindow.webContents.session.clearCache().then(() => {
        mainWindow.loadURL(startUrl);
        // Open DevTools in development mode with options to reduce warnings
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        }
        mainWindow.webContents.openDevTools({ mode: ELECTRON.WINDOW.DEVTOOLS_MODE });
      });
    }, ELECTRON.WINDOW.DEV_RELOAD_DELAY_MS);
  } else {
    const indexPath = path.join(__dirname, "dist", "index.html");

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
          process.env.ELECTRON_START_URL || ELECTRON.DEV_SERVER.URL;
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

  // Clean up the reference when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Replace the top-level await with a proper async function
// eslint-disable-next-line unicorn/prefer-top-level-await
app.whenReady().then(async () => {
  try {
    // Initialize DatabaseBridge
    database = new DatabaseBridge();
    await database.initialize();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    console.log('Falling back to in-memory storage');
    // Continue with in-memory storage as fallback
  }

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

// Track if we're already handling quit to prevent multiple attempts
let isQuitting = false;

app.on("before-quit", async (event) => {
  if (isQuitting) return;
  
  // Prevent default quit to ensure saves complete
  event.preventDefault();
  isQuitting = true;
  
  // Send signal to renderer to perform final save and wait for completion
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // Create a promise that will resolve when save completes or timeout
      const savePromise = new Promise((resolve) => {
        // Set up a one-time listener for save completion
        ipcMain.once('app-will-quit-save-complete', () => {
          resolve('completed');
        });
        
        // Set a timeout as fallback (configurable, default 2 seconds)
        const timeout = process.env.PASTEFLOW_SAVE_TIMEOUT || 2000;
        setTimeout(() => resolve('timeout'), timeout);
      });
      
      // Send message to renderer to trigger save
      mainWindow.webContents.send('app-will-quit');
      
      // Wait for save to complete or timeout
      const result = await savePromise;
      if (result === 'timeout') {
        console.warn('Auto-save timeout during shutdown - proceeding with quit');
      } else {
        console.log('Auto-save completed successfully during shutdown');
      }
    } catch (error) {
      console.error('Error during shutdown save:', error);
    }
  }
  
  // Clean up database connection
  if (database && database.initialized) {
    try {
      await database.close();
      console.log('Database closed successfully');
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }
  
  // Now actually quit
  app.exit(0);
});


// Handle folder selection
ipcMain.on("open-folder", async (event) => {
  // SECURITY: Apply rate limiting
  const validation = ipcValidator.validate('open-folder', {}, event);

  if (!validation.success) {
    console.warn(`Rate limit exceeded for open-folder from sender: ${event.sender.id}`);
    return;
  }

  // Validate using Zod schema (no input parameters)
  try {
    zSchemas.FolderSelectionSchema.parse({});
  } catch (error) {
    console.error('Validation error for open-folder:', error.message);
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
      event.sender.send("folder-selected", pathString);
    } catch (error) {
      console.error("Error sending folder-selected event:", error);
      // Don't send the event again in the catch block to avoid duplicates
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
  // Remove problematic characters that cause tiktoken to fail
  return text
    .replace(/<\|[^|>]+\|>/g, '') // Remove special tokens with <|...|> pattern
    .replace(/\u0000/g, '') // Remove null characters
    .replace(/[\uFFF0-\uFFFF]/g, '') // Remove special use area
    .replace(/[\u{10000}-\u{10FFFF}]/gu, ''); // Remove supplementary private use area
}

// Count tokens using tiktoken with o200k_base encoding
function countTokens(text) {
  // Simple fallback implementation if encoder fails
  if (!encoder) {
    // Very rough estimate using centralized constant
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }

  try {
    // Add sanitization to remove problematic tokens that cause tiktoken to fail
    const sanitizedText = sanitizeTextForTokenCount(text);

    // If the sanitization removed a significant portion of the text, fall back to estimation
    if (sanitizedText.length < text.length * 0.9) {
      console.warn("Text contained many special tokens, using estimation instead");
      return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
    }

    const tokens = encoder.encode(sanitizedText);
    return tokens.length;
  } catch (error) {
    console.error("Error counting tokens:", error);
    // Fallback to character-based estimation on error
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }
}

// Function to process a single file - OPTIMIZED VERSION
function processFile(dirent, fullPath, folderPath, fileSize, mtimeMs) {
  // Skip files that are too large
  if (fileSize > MAX_FILE_SIZE) {
    return {
      name: dirent.name,
      path: fullPath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      mtimeMs,
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
      mtimeMs,
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
    mtimeMs,
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
          results.push(processFile(dirent, fullPath, folderPath, stats.size, stats.mtimeMs));
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
ipcMain.on("request-file-list", async (event, folderPath, exclusionPatterns = [], requestId = null) => {
  // SECURITY: Validate input parameters using both rate limiting and schema validation
  const validation = ipcValidator.validate('request-file-list', { folderPath, exclusionPatterns }, event);

  if (!validation.success) {
    console.warn(`Rate limit validation failed for request-file-list: ${validation.error}`);
    event.sender.send("file-processing-status", {
      status: "error",
      message: validation.error
    });
    return;
  }

  // Additional schema validation
  try {
    zSchemas.FileListRequestSchema.parse({ folderPath, exclusionPatterns, requestId });
  } catch (error) {
    console.warn(`Schema validation failed for request-file-list: ${error.message}`);
    event.sender.send("file-processing-status", {
      status: "error",
      message: error.message
    });
    return;
  }

  const { folderPath: validatedFolderPath, exclusionPatterns: validatedPatterns } = validation.data;

  // Update current request ID
  currentRequestId = requestId;

  try {

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
        mtimeMs: file.mtimeMs,
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
        directories: processedDirs.size,
        requestId: currentRequestId
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
      const MAX_DIRS_PER_BATCH = 20; // Increased for faster directory traversal
      const currentBatchFiles = [];

      // Create adaptive batcher for optimized IPC communication
      const batcher = {
        TARGET_BATCH_SIZE: 200 * 1024, // 200KB target for faster initial display
        MIN_FILES: 50,  // Increased minimum for instant display
        MAX_FILES: 500,  // Increased maximum for large directories
        calculateBatchSize: function(files) {
          if (!files.length) return this.MIN_FILES;
          const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
          const avgFileSize = totalSize / files.length || 1024;
          const optimalCount = Math.floor(this.TARGET_BATCH_SIZE / avgFileSize);
          return Math.max(this.MIN_FILES, Math.min(this.MAX_FILES, optimalCount));
        }
      };

      let dynamicBatchSize = batcher.calculateBatchSize(currentBatchFiles);

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

          // Process files in parallel for better performance
          const filePromises = [];

          for (const dirent of dirents) {
            const fullPath = path.join(dirPath, dirent.name);
            const relativePath = path.relative(folderPath, fullPath);

            if (ignoreFilter.ignores(relativePath)) {
              continue;
            }

            if (dirent.isDirectory()) {
              directoryQueue.push({ path: fullPath, depth: depth + 1 });
            } else if (dirent.isFile()) {
              // Queue file processing for parallel execution
              filePromises.push(
                fs.promises.stat(fullPath).then(stats => {
                  const fileInfo = processFile(dirent, fullPath, folderPath, stats.size, stats.mtimeMs);
                  currentBatchFiles.push(fileInfo);
                  allFiles.push(fileInfo);
                }).catch(error => {
                  console.error(`Error processing file ${fullPath}:`, error);
                })
              );

              // Process in chunks to avoid overwhelming the system
              if (filePromises.length >= 10) {
                await Promise.all(filePromises);
                filePromises.length = 0;
              }
            }
          }

          // Process any remaining file promises
          if (filePromises.length > 0) {
            await Promise.all(filePromises);
          }
        } catch (error) {
          console.error(`Error reading directory ${dirPath}:`, error);
        }

        // Recalculate batch size based on current files
        dynamicBatchSize = batcher.calculateBatchSize(currentBatchFiles);

        // Send batch when we have enough files (using adaptive size)
        if (currentBatchFiles.length >= dynamicBatchSize) {
          sendBatch(currentBatchFiles, false);
          currentBatchFiles.length = 0; // Clear the batch

          // Add small delay to prevent IPC flooding
          await new Promise(resolve => setTimeout(resolve, 10));
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
ipcMain.on("cancel-file-loading", (event, requestId = null) => {
  // SECURITY: Apply rate limiting
  const validation = ipcValidator.validate('cancel-file-loading', { requestId }, event);

  if (!validation.success) {
    console.warn(`Rate limit exceeded for cancel-file-loading from sender: ${event.sender.id}`);
    return;
  }

  try {
    // Validate input if requestId is provided
    if (requestId !== null) {
      zSchemas.CancelFileLoadingSchema.parse({ requestId });
    }

    fileLoadingCancelled = true;
    currentRequestId = null; // Clear request ID when canceling
  } catch (error) {
    console.error('Invalid input for cancel-file-loading:', error.message);
  }
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
  // SECURITY: Apply rate limiting
  const validation = ipcValidator.validate('open-docs', { docName }, event);

  if (!validation.success) {
    console.warn(`Rate limit exceeded for open-docs from sender: ${event.sender.id}`);
    return;
  }

  try {
    // Validate input using Zod
    zSchemas.OpenDocsSchema.parse({ docName });
  } catch (error) {
    console.warn('Invalid input for open-docs:', error.message);
    return;
  }

  // Extract sanitized document name from validation
  const sanitizedDocName = path.basename(docName);

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
  try {
    // Validate input using Zod
    zSchemas.RequestFileContentSchema.parse({ filePath });
  } catch (error) {
    console.error('Invalid input for request-file-content:', error.message);
    return { success: false, error: error.message };
  }

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

  // Preflight: skip known binary/special files before reading
  if (isBinaryFile(filePath) || isSpecialFile(filePath)) {
    return { success: false, error: 'File contains binary data', isBinary: true };
  }
  try {
    const content = await fs.promises.readFile(validation.sanitizedPath, 'utf8');
    if (isLikelyBinaryContent(content, filePath)) {
      return { success: false, error: 'File contains binary data', isBinary: true };
    }
    const tokenCount = countTokens(content);
    return { success: true, content, tokenCount };
  } catch (error) {
    // If read failed, hint binary based on extension to help the UI stop retrying
    const extIsBinary = isBinaryFile(filePath) || isSpecialFile(filePath);
    return { success: false, error: error.message, isBinary: extIsBinary };
  }
});

// Workspace management handlers

ipcMain.handle('/workspace/list', async () => {
  try {
    // Use database if available
    if (database && database.initialized) {
      const workspaces = await database.listWorkspaces();
      // Convert numeric IDs to strings for compatibility with frontend expectations
      return workspaces.map(workspace => ({
        ...workspace,
        id: String(workspace.id)
      }));
    }

    // Fallback to in-memory store
    const workspaces = Array.from(workspaceStore.entries())
      .sort((a, b) => (b[1].lastAccessed || 0) - (a[1].lastAccessed || 0))
      .map(([name, data]) => ({
        id: name,
        name: name,
        folderPath: data.folderPath || '',
        state: data.state || {},
        createdAt: data.createdAt || Date.now(),
        updatedAt: data.updatedAt || Date.now(),
        lastAccessed: data.lastAccessed || Date.now()
      }));
    return workspaces;
  } catch (error) {
    console.error('Error listing workspaces:', error);
    return [];
  }
});

ipcMain.handle('/workspace/create', async (event, params) => {
  try {
    // Validate input with Zod
    const validated = zSchemas.WorkspaceCreateSchema.parse(params);
    const { name, folderPath, state } = validated;

    // Use database if available
    if (database && database.initialized) {
      const workspace = await database.createWorkspace(name, folderPath, state);
      // Convert numeric ID to string for compatibility with frontend expectations
      return { success: true, workspace: {
        ...workspace,
        id: String(workspace.id)
      }};
    }

    // Fallback to in-memory store
    const now = Date.now();
    workspaceStore.set(name, {
      folderPath,
      state,
      createdAt: now,
      updatedAt: now,
      lastAccessed: now
    });
    return { success: true };
  } catch (error) {
    console.error('Error creating workspace:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('/workspace/load', async (event, params) => {
  try {
    // Ensure params is an object
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters provided');
    }

    // Validate input with Zod (id may be UUID or name during transition)
    const validated = zSchemas.WorkspaceLoadSchema.parse(params);
    const { id } = validated;
    // Use database if available
    if (database && database.initialized) {
      const workspace = await database.getWorkspace(id);
      // Return null for non-existent workspaces instead of throwing
      // This is expected during workspace auto-generation
      if (!workspace) {
        return null;
      }
      // Convert numeric ID to string for compatibility with frontend expectations
      return {
        ...workspace,
        id: String(workspace.id)
      };
    }

    // Fallback to in-memory store
    const workspace = workspaceStore.get(id);
    if (!workspace) {
      // Return null for non-existent workspaces instead of throwing
      // This is expected during workspace auto-generation
      return null;
    }

    return {
      id: id,
      name: id,
      folderPath: workspace.folderPath || '',
      state: workspace.state || {},
      createdAt: workspace.createdAt || Date.now(),
      updatedAt: workspace.updatedAt || Date.now(),
      lastAccessed: workspace.lastAccessed || Date.now()
    };
  } catch (error) {
    console.error('Error loading workspace:', error);
    throw error;
  }
});

ipcMain.handle('/workspace/update', async (event, params) => {
  try {
    // Validate input with Zod (legacy: allow id or name; state/folderPath optional)
    const validated = zSchemas.WorkspaceUpdateSchema.parse(params);
    const { id, name, folderPath, state } = validated;
    // Use database if available
    if (database && database.initialized) {
      // Try to find workspace by id first, then by name
      let workspace = null;
      if (id) {
        workspace = await database.getWorkspace(id);
      } else if (name) {
        workspace = await database.getWorkspace(name);
      }

      if (workspace) {
        await database.updateWorkspace(workspace.name, state);
        return { success: true };
      } else {
        return { success: false, error: 'Workspace not found' };
      }
    }

    // Fallback to in-memory store
    const workspaceKey = id || name;
    const existing = workspaceStore.get(workspaceKey);
    if (!existing) {
      return { success: false, error: 'Workspace not found' };
    }

    workspaceStore.set(workspaceKey, {
      ...existing,
      folderPath: folderPath !== undefined ? folderPath : existing.folderPath,
      state: state !== undefined ? state : existing.state,
      updatedAt: Date.now()
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating workspace:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('/workspace/touch', async (event, params) => {
  try {
    // Validate input with Zod (legacy: id or name)
    const validated = zSchemas.WorkspaceTouchSchema.parse(params);
    const { id, name } = validated;
    // Use database if available
    if (database && database.initialized) {
      // Try to find workspace by id first, then by name
      let workspace = null;
      if (id) {
        workspace = await database.getWorkspace(id);
      } else if (name) {
        workspace = await database.getWorkspace(name);
      }

      if (workspace) {
        await database.touchWorkspace(workspace.name);
        return { success: true };
      } else {
        return { success: false, error: 'Workspace not found' };
      }
    }

    // Fallback to in-memory store
    const workspaceKey = id || name;
    const existing = workspaceStore.get(workspaceKey);
    if (!existing) {
      return { success: false, error: 'Workspace not found' };
    }

    workspaceStore.set(workspaceKey, {
      ...existing,
      lastAccessed: Date.now()
    });
    return { success: true };
  } catch (error) {
    console.error('Error touching workspace:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('/workspace/delete', async (event, params) => {
  try {
    // Validate input with Zod
    const validated = zSchemas.WorkspaceDeleteSchema.parse(params);
    const { id } = validated;
    // Use database if available
    if (database && database.initialized) {
      await database.deleteWorkspaceById(id);
      return { success: true };
    }

    // Fallback to in-memory store (for backward compatibility, treat id as name)
    workspaceStore.delete(id);
    return { success: true };
  } catch (error) {
    console.error('Error deleting workspace:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('/workspace/rename', async (event, params) => {
  try {
    // Validate input with Zod
    const validated = zSchemas.WorkspaceRenameSchema.parse(params);
    const { oldName, newName } = validated;
    // Use database if available
    if (database && database.initialized) {
      await database.renameWorkspace(oldName, newName);
      return { success: true };
    }

    // Fallback to in-memory store
    const existing = workspaceStore.get(oldName);
    if (!existing) {
      return { success: false, error: 'Workspace not found' };
    }

    workspaceStore.set(newName, {
      ...existing,
      updatedAt: Date.now()
    });
    workspaceStore.delete(oldName);
    return { success: true };
  } catch (error) {
    console.error('Error renaming workspace:', error);
    return { success: false, error: error.message };
  }
});

// Instructions handlers
ipcMain.handle('/instructions/list', async () => {
  try {
    if (database && database.initialized) {
      return await database.listInstructions();
    }
    throw new Error('Database not initialized');
  } catch (error) {
    console.error('Failed to list instructions:', error);
    throw error;
  }
});

ipcMain.handle('/instructions/create', async (event, params) => {
  try {
    if (database && database.initialized) {
      await database.createInstruction(params.id, params.name, params.content);
      return { success: true };
    }
    throw new Error('Database not initialized');
  } catch (error) {
    console.error('Failed to create instruction:', error);
    throw error;
  }
});

ipcMain.handle('/instructions/update', async (event, params) => {
  try {
    if (database && database.initialized) {
      await database.updateInstruction(params.id, params.name, params.content);
      return { success: true };
    }
    throw new Error('Database not initialized');
  } catch (error) {
    console.error('Failed to update instruction:', error);
    throw error;
  }
});

ipcMain.handle('/instructions/delete', async (event, params) => {
  try {
    if (database && database.initialized) {
      await database.deleteInstruction(params.id);
      return { success: true };
    }
    throw new Error('Database not initialized');
  } catch (error) {
    console.error('Failed to delete instruction:', error);
    throw error;
  }
});

// Helper function to broadcast updates to all renderer processes
function broadcastUpdate(channel, data) {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send(channel, data);
  }
}

// Preferences handlers
ipcMain.handle('/prefs/get', async (event, params) => {
  try {
    // Handle various input formats
    let key;
    if (typeof params === 'string') {
      // Direct string key
      key = params;
    } else if (params && typeof params === 'object' && 'key' in params) {
      // Object with key property
      key = params.key;
    } else {
      console.error('Invalid /prefs/get params:', params);
      return null; // Return null instead of throwing for missing keys
    }

    if (!key || typeof key !== 'string') {
      console.error('Invalid key provided to /prefs/get:', key);
      return null; // Return null for invalid keys
    }

    // Use database if available and initialized
    if (database && database.initialized) {
      const value = await database.getPreference(key);
      return value !== undefined ? value : null;
    }

    // Fallback to in-memory store
    const value = preferencesStore.get(key);
    // Return just the value, not wrapped in an object
    // Return null if undefined to match database behavior
    return value !== undefined ? value : null;
  } catch (error) {
    console.error('Error getting preference:', error);
    console.error('Params were:', params);
    throw error; // Let the renderer handle the error
  }
});

ipcMain.handle('/prefs/set', async (event, params) => {
  try {
    // Handle various input formats
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: object with key and value required');
    }

    const { key, value } = params;

    if (!key || typeof key !== 'string') {
      throw new Error('Invalid key provided');
    }

    // Use database if available
    if (database && database.initialized) {
      await database.setPreference(key, value);
      // Broadcast update to notify all renderer processes
      broadcastUpdate('/prefs/get:update');
      return true;
    }

    // Fallback to in-memory store
    preferencesStore.set(key, value);
    // Broadcast update to notify all renderer processes
    broadcastUpdate('/prefs/get:update');
    // Return boolean to match expected behavior
    return true;
  } catch (error) {
    console.error('Error setting preference:', error);
    console.error('Params were:', params);
    throw error; // Let the renderer handle the error
  }
});

