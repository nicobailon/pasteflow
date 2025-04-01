const fs = require("node:fs");
const path = require("node:path");

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");

// Import XML utilities
const { parseXmlString, applyFileChanges, prepareXmlWithCdata } = require("./src/main/xml-utils");
const { xmlFormatInstructions } = require('./src/main/xml-format-instructions');

// Add handling for the 'ignore' module
let ignore;
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
].concat(binaryExtensions || [])); // Add any additional binary extensions from excluded-files.js

// Max file size to read (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Regex pattern to detect potential binary content
const BINARY_CONTENT_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u00FF]{50,}/;
const SPECIAL_TOKEN_REGEX = /<\|endoftext\|>/;

// Special file extensions to skip (not even try to read)
const SPECIAL_FILE_EXTENSIONS = new Set(['.asar', '.bin', '.dll', '.exe', '.so', '.dylib']);

// Function to check if file content is likely binary
function isLikelyBinaryContent(content, filePath) {
  // Skip binary content check for JavaScript files
  if (filePath && path.extname(filePath).toLowerCase() === '.js') {
    return false;
  }
  // Check for sequences of non-ASCII characters
  return BINARY_CONTENT_REGEX.test(content) || SPECIAL_TOKEN_REGEX.test(content);
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

  // In development, load from Vite dev server
  // In production, load from built files
  const isDev = process.env.NODE_ENV === "development";
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

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle folder selection
ipcMain.on("open-folder", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    try {
      // Ensure we're only sending a string, not an object
      const pathString = String(selectedPath);
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
function loadGitignore(rootDir) {
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

  return ig;
}

// Check if file is binary based on extension
function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext) || isSpecialFile(filePath);
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
    // This handles the <|endoftext|> token and other potential special tokens
    const sanitizedText = text
      .replace(/<\|endoftext\|>/g, "") // Remove the problematic token
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // Remove control characters
    
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

// Global cancellation flag for file loading
let fileLoadingCancelled = false;

// Handle file list request
ipcMain.on("request-file-list", (event, folderPath) => {
  try {
    console.log("Received request for file list in:", folderPath);
    
    // Reset cancellation flag when starting a new request
    fileLoadingCancelled = false;

    // Send status update to indicate processing has started
    event.sender.send("file-processing-status", {
      status: "processing",
      message: "Scanning directory structure...",
    });

    // This will hold all the file entries
    let allFiles = [];
    
    // Queue to keep track of directories to process
    let directoryQueue = [{path: folderPath, depth: 0}];
    
    // Batch size - adjust based on performance testing
    const BATCH_SIZE = 100;
    
    // Maximum directories to process in one batch
    const MAX_DIRS_PER_BATCH = 20;
    
    // Maximum depth to process at once (process higher levels first)
    const MAX_DEPTH = 20;
    
    // Track processed directories to avoid duplicate work
    const processedDirs = new Set();
    
    // Create the ignore filter once
    const ignoreFilter = loadGitignore(folderPath);
    
    // Process directories in batches
    const processNextBatch = () => {
      // Check if loading has been cancelled
      if (fileLoadingCancelled) {
        console.log("File loading cancelled");
        event.sender.send("file-processing-status", {
          status: "idle",
          message: "File loading cancelled",
        });
        return;
      }
      
      // Limit the number of directories we process in one go
      let processedDirsCount = 0;
      let filesInBatch = 0;
      let nextBatchDirs = [];
      
      // While we have directories to process and haven't hit our batch limit
      while (directoryQueue.length > 0 && 
             processedDirsCount < MAX_DIRS_PER_BATCH && 
             filesInBatch < BATCH_SIZE) {
        
        // Get the next directory to process (prioritize lower depths)
        directoryQueue.sort((a, b) => a.depth - b.depth);
        const { path: dirPath, depth } = directoryQueue.shift();
        
        // Skip if already processed
        if (processedDirs.has(dirPath)) {
          continue;
        }
        
        // Skip if we've reached max depth for this batch
        if (depth > MAX_DEPTH) {
          nextBatchDirs.push({ path: dirPath, depth });
          continue;
        }
        
        processedDirs.add(dirPath);
        processedDirsCount++;
        
        try {
          // Read directory entries
          const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
          
          // Process each entry
          for (const dirent of dirents) {
            const fullPath = path.join(dirPath, dirent.name);
            const relativePath = path.relative(folderPath, fullPath);
            
            // Skip if the path is ignored
            if (ignoreFilter.ignores(relativePath)) {
              continue;
            }
            
            if (dirent.isDirectory()) {
              // Queue subdirectory for later processing
              directoryQueue.push({ path: fullPath, depth: depth + 1 });
            } else if (dirent.isFile()) {
              try {
                // Get file stats
                const stats = fs.statSync(fullPath);
                const fileSize = stats.size;
                
                // Skip files that are too large
                if (fileSize > MAX_FILE_SIZE) {
                  allFiles.push({
                    name: dirent.name,
                    path: fullPath,
                    tokenCount: 0,
                    size: fileSize,
                    content: "",
                    isBinary: false,
                    isSkipped: true,
                    error: "File too large to process",
                  });
                  continue;
                }
                
                // Check if file has special extension that should be skipped entirely
                if (isSpecialFile(fullPath)) {
                  allFiles.push({
                    name: dirent.name,
                    path: fullPath,
                    tokenCount: 0,
                    size: fileSize,
                    content: "",
                    isBinary: true,
                    isSkipped: true,
                    fileType: path.extname(fullPath).slice(1).toUpperCase(),
                    error: "Special file type skipped",
                  });
                  continue;
                }
                
                // Check if binary
                const isBinary = isBinaryFile(fullPath);
                
                if (isBinary) {
                  // Skip content for binary files
                  allFiles.push({
                    name: dirent.name,
                    path: fullPath,
                    tokenCount: 0,
                    size: fileSize,
                    content: "",
                    isBinary: true,
                    isSkipped: false,
                    fileType: path.extname(fullPath).slice(1).toUpperCase(),
                  });
                } else {
                  // Read file content with error handling
                  try {
                    const fileContent = fs.readFileSync(fullPath, "utf8");
                    
                    // Check if this is actually binary content that was missed by the extension check
                    if (isLikelyBinaryContent(fileContent, fullPath)) {
                      console.log(`File ${fullPath} appears to contain binary data or special tokens, marking as binary`);
                      allFiles.push({
                        name: dirent.name,
                        path: fullPath,
                        tokenCount: 0,
                        size: fileSize,
                        content: "",
                        isBinary: true,
                        isSkipped: false,
                        fileType: "BINARY",
                      });
                    } else {
                      allFiles.push({
                        name: dirent.name,
                        path: fullPath,
                        size: fileSize,
                        isBinary: false,
                        isSkipped: false,
                        fileType: path.extname(fullPath).slice(1).toUpperCase(),
                        excludedByDefault: shouldExcludeByDefault(fullPath, folderPath),
                        isContentLoaded: false
                      });
                    }
                  } catch (error) {
                    // Improve error logging to be more concise
                    if (error.code === 'ENOENT') {
                      console.log(`File not found: ${fullPath}`);
                    } else {
                      console.error(`Error reading file ${fullPath}: ${error.code || error.message}`);
                    }
                    
                    allFiles.push({
                      name: dirent.name,
                      path: fullPath,
                      tokenCount: 0,
                      size: fileSize,
                      content: "",
                      isBinary: false,
                      isSkipped: true,
                      error: error.code === 'ENOENT' ? "File not found" : "Could not read file",
                    });
                  }
                }
                
                filesInBatch++;
                
                // If batch is full, break out to process this batch
                if (filesInBatch >= BATCH_SIZE) {
                  break;
                }
              } catch (error) {
                console.error(`Error processing file ${fullPath}:`, error);
              }
            }
          }
          
          // If batch is full, stop processing directories
          if (filesInBatch >= BATCH_SIZE) {
            break;
          }
        } catch (error) {
          console.error(`Error reading directory ${dirPath}:`, error);
        }
      }
      
      // Add any skipped directories back to the queue
      directoryQueue = [...directoryQueue, ...nextBatchDirs];
      
      // Send progress update
      event.sender.send("file-processing-status", {
        status: "processing",
        message: `Processed ${allFiles.length} files... (${processedDirs.size} directories)`,
        processed: allFiles.length,
        directories: processedDirs.size
      });
      
      // Check if we're done
      if (directoryQueue.length === 0) {
        finishProcessing();
      } else {
        // Schedule next batch with a small delay to let UI update
        setTimeout(processNextBatch, 10);
      }
    };
    
    // Function to finish processing and send results
    const finishProcessing = () => {
      // Check if cancelled before finalizing
      if (fileLoadingCancelled) {
        return;
      }
      
      // Update with processing complete status
      event.sender.send("file-processing-status", {
        status: "complete",
        message: `Found ${allFiles.length} files`,
      });
      
      // Process the files to ensure they're serializable
      const serializableFiles = allFiles.map((file) => {
        // Create a clean file object
        return {
          name: file.name ? String(file.name) : "",
          path: file.path ? String(file.path) : "",
          tokenCount: typeof file.tokenCount === "number" ? file.tokenCount : 0,
          size: typeof file.size === "number" ? file.size : 0,
          content: file.isBinary
            ? ""
            : (typeof file.content === "string"
            ? file.content
            : ""),
          isBinary: Boolean(file.isBinary),
          isSkipped: Boolean(file.isSkipped),
          error: file.error ? String(file.error) : null,
          fileType: file.fileType ? String(file.fileType) : null,
          excludedByDefault: shouldExcludeByDefault(file.path, folderPath),
        };
      });
      
      try {
        console.log(`Sending ${serializableFiles.length} files to renderer`);
        event.sender.send("file-list-data", serializableFiles);
      } catch (error) {
        console.error("Error sending file data:", error);
        
        // If sending fails, try again with minimal data
        const minimalFiles = serializableFiles.map((file) => ({
          name: file.name,
          path: file.path,
          tokenCount: file.tokenCount,
          size: file.size,
          isBinary: file.isBinary,
          isSkipped: file.isSkipped,
          excludedByDefault: file.excludedByDefault,
        }));
        
        event.sender.send("file-list-data", minimalFiles);
      }
    };
    
    // Start processing the first batch
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

// Handle XML changes application
ipcMain.on("apply-changes", async (event, { xml, projectDirectory }) => {
  try {
    console.log("Applying XML changes to directory:", projectDirectory);
    
    // Check if XML is empty or invalid
    if (!xml || typeof xml !== 'string' || xml.trim().length === 0) {
      throw new Error("XML content is empty or invalid");
    }
    
    // Add debug output
    console.log(`Processing XML input (${xml.length} characters) for project at ${projectDirectory}`);
    
    // Apply safety preprocessing to fix common issues before parsing
    xml = prepareXmlWithCdata(xml);
    
    // Parse the XML string
    let changes;
    try {
      changes = await parseXmlString(xml);
    } catch (parseError) {
      console.error("XML parsing error:", parseError);
      
      // Provide a more helpful error message
      let errorMessage = parseError.message || "Unknown parsing error";
      if (errorMessage.includes("Opening and ending tag mismatch")) {
        errorMessage = `XML syntax error: ${errorMessage}. This usually happens with JSX code that needs to be wrapped in CDATA sections. Try using the Format XML button.`;
      } else if (errorMessage.includes("CDATA")) {
        errorMessage = `CDATA section error: ${errorMessage}. JSX code with curly braces needs special handling.`;
      }
      
      throw new Error(`Failed to parse XML: ${errorMessage}`);
    }
    
    if (!changes || changes.length === 0) {
      throw new Error("Invalid XML format or no changes found");
    }
    
    console.log(`Found ${changes.length} file changes to apply`);
    
    // Apply each change sequentially
    const updatedFiles = [];
    const failedFiles = [];
    
    for (const change of changes) {
      try {
        console.log(`Applying ${change.file_operation} operation to ${change.file_path}`);
        await applyFileChanges(change, projectDirectory);
        updatedFiles.push(change.file_path);
      } catch (error) {
        console.error(`Failed to apply ${change.file_operation} to ${change.file_path}:`, error);
        failedFiles.push({ 
          path: change.file_path, 
          reason: error.message || 'Unknown error' 
        });
      }
    }
    
    // Add detailed result logging
    console.log(`Result summary: Successfully processed ${updatedFiles.length} of ${changes.length} files`);
    if (updatedFiles.length > 0) {
      console.log("Updated files:", updatedFiles);
    } else {
      console.log("No files were updated successfully");
    }
    
    if (failedFiles.length > 0) {
      console.log("Failed files:");
      for (const failure of failedFiles) {
        console.log(`- ${failure.path}: ${failure.reason}`);
      }
    }
    
    // Check file system to verify updates
    if (updatedFiles.length > 0) {
      console.log("Verifying file updates on disk:");
      for (const filePath of updatedFiles) {
        try {
          const fullPath = path.join(projectDirectory, filePath);
          const stats = fs.statSync(fullPath);
          console.log(`File ${filePath} exists on disk, size: ${stats.size} bytes, modified: ${stats.mtime}`);
        } catch (error) {
          console.error(`Verification failed for ${filePath}: ${error.message}`);
        }
      }
    }
    
    // Determine overall success and appropriate message
    const success = updatedFiles.length > 0;
    const message = success 
      ? `Successfully applied changes to ${updatedFiles.length} of ${changes.length} files.` 
      : "No files were updated successfully.";
    
    // Check if all requested changes were applied successfully
    const allChangesSuccessful = updatedFiles.length === changes.length;
    
    // Send response with detailed information
    event.sender.send("apply-changes-response", { 
      success: success,  // Only return true if at least one file was updated
      message: allChangesSuccessful 
        ? `Successfully applied all ${changes.length} file changes.`
        : `Applied ${updatedFiles.length} of ${changes.length} file changes.`,
      updatedFiles: updatedFiles,
      failedFiles: failedFiles,
      details: updatedFiles.length > 0 
        ? `Updated files: ${updatedFiles.join(', ')}` 
        : "No files were updated.",
      warningMessage: failedFiles.length > 0 
        ? `Failed to update ${failedFiles.length} ${failedFiles.length === 1 ? 'file' : 'files'}: ${failedFiles.map(f => f.path).join(', ')}` 
        : undefined
    });
  } catch (error) {
    console.error("Error applying changes:", error);
    
    // Enhanced error messages with more helpful suggestions
    let errorMessage = error.message || "Unknown error occurred";
    let additionalInfo = "";
    
    // Check for specific XML parsing issues and provide better guidance
    if (errorMessage.includes("Opening and ending tag mismatch")) {
      additionalInfo = "This often happens with JSX code that's not wrapped in CDATA sections. Use the Format XML button to fix this issue.";
    } else if (errorMessage.includes("no longer supported")) {
      additionalInfo = "Try restarting the application or using the Format XML button.";
    } else if (errorMessage.includes("Failed to") && errorMessage.includes("file")) {
      additionalInfo = "Check file permissions and make sure the path is correct.";
    } else if (errorMessage.includes("ENOENT")) {
      additionalInfo = "Directory not found. Make sure the path exists.";
    }
    
    const fullErrorMessage = additionalInfo 
      ? `${errorMessage}. ${additionalInfo}`
      : errorMessage;
    
    event.sender.send("apply-changes-response", {
      success: false,
      error: fullErrorMessage
    });
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

// Add a new IPC handler for getting the XML formatting instructions
ipcMain.handle('get-xml-format-instructions', () => {
  return xmlFormatInstructions;
});

// Add a new IPC handler for opening documentation
ipcMain.on('open-docs', (event, docName) => {
  // Path to the documentation file
  const docPath = path.join(__dirname, 'docs', docName);
  
  // Check if the file exists
  fs.access(docPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`Documentation file not found: ${docPath}`);
      return;
    }
    
    // Open the file in the default application
    shell.openPath(docPath)
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
    const content = await fs.promises.readFile(filePath, 'utf8');
    if (isLikelyBinaryContent(content, filePath)) {
      return { success: false, error: 'File contains binary data', isBinary: true };
    }
    const tokenCount = countTokens(content);
    return { success: true, content, tokenCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add this near the other IPC handlers
ipcMain.handle("format-xml", async (event, { xml }) => {
  try {
    const formattedXml = prepareXmlWithCdata(xml);
    return { success: true, xml: formattedXml };
  } catch (error) {
    console.error("Error formatting XML:", error);
    return { success: false, error: error.message || "Unknown error occurred" };
  }
});