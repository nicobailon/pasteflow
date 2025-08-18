import fs from 'node:fs';
import path from 'node:path';

import { FileData } from '../types/file-types';

import { loadGitignore } from './ignore-utils';

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

// Function to check if file is binary based on extension
const isBinaryFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
};

// Regex pattern to detect potential binary content
/* eslint-disable-next-line no-control-regex */
const BINARY_CONTENT_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u00FF]{50,}/;

// Function to check if file content is likely binary
const isLikelyBinaryContent = (content: string, filePath: string): boolean => {
  // Skip binary content check for JavaScript files
  if (filePath && path.extname(filePath).toLowerCase() === '.js') {
    return false;
  }
  // Special tokens handled via sanitization during token counting,
  // not during binary detection, to allow analysis of AI/ML codebases
  // Check for sequences of non-ASCII characters
  return BINARY_CONTENT_REGEX.test(content);
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface DirectoryQueueItem {
  path: string;
  depth: number;
}

interface ProcessBatchResult {
  nextBatchDirs: DirectoryQueueItem[];
  processedDirsCount: number;
  filesInBatch: number;
}

interface IgnoreFilter {
  ignores: (path: string) => boolean;
}

const processFile = async (
  filePath: string,
  folderPath: string,
): Promise<FileData> => {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const dirent = { name: path.basename(filePath) };

  if (fileSize > MAX_FILE_SIZE) {
    return {
      name: dirent.name,
      path: filePath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      isBinary: false,
      isSkipped: true,
      error: "File too large to process",
      isDirectory: false
    };
  }

  if (isBinaryFile(filePath)) {
    return {
      name: dirent.name,
      path: filePath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      isBinary: true,
      isSkipped: false,
      fileType: path.extname(filePath).slice(1).toUpperCase(),
      isDirectory: false
    };
  }

  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    if (isLikelyBinaryContent(fileContent, filePath)) {
      return {
        name: dirent.name,
        path: filePath,
        tokenCount: 0,
        size: fileSize,
        content: "",
        isBinary: true,
        isSkipped: false,
        fileType: "BINARY",
        isDirectory: false
      };
    }

    return {
      name: dirent.name,
      path: filePath,
      size: fileSize,
      isBinary: false,
      isSkipped: false,
      fileType: path.extname(filePath).slice(1).toUpperCase(),
      excludedByDefault: shouldExcludeByDefault(filePath, folderPath),
      isContentLoaded: false,
      isDirectory: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error && error.message === 'ENOENT' 
      ? "File not found" 
      : "Could not read file";
      
    return {
      name: dirent.name,
      path: filePath,
      tokenCount: 0,
      size: fileSize,
      content: "",
      isBinary: false,
      isSkipped: true,
      error: errorMessage,
      isDirectory: false
    };
  }
};

const processBatch = async (
  directoryQueue: DirectoryQueueItem[],
  processedDirs: Set<string>,
  allFiles: FileData[],
  folderPath: string,
  ignoreFilter: IgnoreFilter,
  MAX_DIRS_PER_BATCH: number,
  BATCH_SIZE: number,
  MAX_DEPTH: number
): Promise<ProcessBatchResult> => {
  let processedDirsCount = 0;
  let filesInBatch = 0;
  const nextBatchDirs: DirectoryQueueItem[] = [];

  while (directoryQueue.length > 0 && 
         processedDirsCount < MAX_DIRS_PER_BATCH && 
         filesInBatch < BATCH_SIZE) {
    
    directoryQueue.sort((a, b) => a.depth - b.depth);
    const { path: dirPath, depth } = directoryQueue.shift()!;
    
    if (processedDirs.has(dirPath)) continue;
    if (depth > MAX_DEPTH) {
      nextBatchDirs.push({ path: dirPath, depth });
      continue;
    }
    
    processedDirs.add(dirPath);
    processedDirsCount++;
    
    try {
      const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const dirent of dirents) {
        const fullPath = path.join(dirPath, dirent.name);
        const relativePath = path.relative(folderPath, fullPath);
        
        if (ignoreFilter.ignores(relativePath)) continue;
        
        if (dirent.isDirectory()) {
          directoryQueue.push({ path: fullPath, depth: depth + 1 });
        } else if (dirent.isFile()) {
          const fileInfo = await processFile(fullPath, folderPath);
          allFiles.push(fileInfo);
          filesInBatch++;
          
          if (filesInBatch >= BATCH_SIZE) break;
        }
      }
      
      if (filesInBatch >= BATCH_SIZE) break;
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
  }

  return {
    nextBatchDirs,
    processedDirsCount,
    filesInBatch
  };
};

const shouldExcludeByDefault = (filePath: string, rootDir: string): boolean => {
  const relativePath = path.relative(rootDir, filePath);
  const relativePathNormalized = relativePath.replace(/\\/g, "/");
  return loadGitignore(rootDir).ignores(relativePathNormalized);
};

export {
  processFile,
  processBatch,
  shouldExcludeByDefault
}; 