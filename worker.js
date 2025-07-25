const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// Binary file extensions
const BINARY_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.avi', '.mov', '.mkv', '.flac',
  '.zip', '.rar', '.tar', '.gz', '.7z',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.class', '.o', '.pyc',
  '.db', '.sqlite', '.sqlite3',
  '.woff', '.woff2', '.ttf', '.eot',
  '.jar', '.war', '.ear',
  '.bin', '.dat', '.pak',
  '.node', '.wasm'
]);

const SPECIAL_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.env', '.env.local', '.env.production', '.env.development'
]);

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isSpecialFile(filePath) {
  const basename = path.basename(filePath);
  return SPECIAL_FILES.has(basename);
}

async function processFiles(files, folderPath) {
  const results = [];
  
  for (const file of files) {
    try {
      const stats = await fs.promises.stat(file.path);
      
      // Skip files that are too large (> 10MB)
      if (stats.size > 10 * 1024 * 1024) {
        results.push({
          ...file,
          size: stats.size,
          isBinary: false,
          isSkipped: true,
          error: "File too large to process",
          isContentLoaded: false
        });
        continue;
      }

      // Check if file is special
      if (isSpecialFile(file.path)) {
        results.push({
          ...file,
          size: stats.size,
          isBinary: true,
          isSkipped: true,
          fileType: path.extname(file.path).slice(1).toUpperCase(),
          error: "Special file type skipped",
          isContentLoaded: false
        });
        continue;
      }

      // Check if binary
      const isBinary = isBinaryFile(file.path);
      
      results.push({
        ...file,
        size: stats.size,
        isBinary,
        isSkipped: false,
        fileType: path.extname(file.path).slice(1).toUpperCase() || 'TEXT',
        isContentLoaded: false,
        isDirectory: false
      });
      
    } catch (error) {
      results.push({
        ...file,
        size: 0,
        isBinary: false,
        isSkipped: true,
        error: error.code === 'ENOENT' ? "File not found" : "Could not read file",
        isContentLoaded: false,
        isDirectory: false
      });
    }
  }
  
  return results;
}

// Process the batch of files
processFiles(workerData.files, workerData.folderPath)
  .then(results => {
    parentPort.postMessage({ results });
  })
  .catch(error => {
    parentPort.postMessage({ error: error.message });
  });