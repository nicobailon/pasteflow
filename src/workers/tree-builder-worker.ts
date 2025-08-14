import type { FileData, TreeNode } from '../types/file-types';
import { UI } from '../constants/app-constants';

interface TreeBuilderMessage {
  type?: 'INIT' | 'BUILD_TREE' | 'CANCEL';
  allFiles?: FileData[];
  chunkSize?: number;
  selectedFolder?: string | null;
  expandedNodes?: Record<string, boolean>;
  id?: string;
}

interface TreeNodeMap {
  [key: string]: {
    name: string;
    path: string;
    children?: TreeNodeMap;
    isDirectory?: boolean;
    isFile?: boolean;
    isExpanded?: boolean;
    fileData?: FileData;
  };
}

// Normalize path for consistent comparison
function normalizePath(path: string): string {
  // Normalize slashes and remove a single trailing slash for boundary-safe comparisons
  return path.replace(/\\/g, '/').replace(/\/$/, '');
}

// Convert hierarchical map to TreeNode array
// maxDepth limits how deep to include children (use Infinity for full depth)
function convertToTreeNodes(
  nodeMap: TreeNodeMap,
  level = 0,
  shouldSort = false, // Sorting is now handled by the centralized service
  maxDepth: number = Number.POSITIVE_INFINITY,
  includeFileData: boolean = true
): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const key in nodeMap) {
    const node = nodeMap[key];

    if (node.isFile) {
      const fileNode: TreeNode = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'file',
        level,
        fileData: includeFileData ? node.fileData : undefined
      };
      nodes.push(fileNode);
    } else if (node.isDirectory) {
      const treeNode: TreeNode = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'directory',
        level,
        isExpanded: node.isExpanded ?? false,
        children: (level + 1 < maxDepth && node.children && Object.keys(node.children).length > 0)
          ? convertToTreeNodes(node.children, level + 1, shouldSort, maxDepth, includeFileData)
          : undefined
      };
      nodes.push(treeNode);
    }
  }

  if (shouldSort) {
    // Basic alphabetical sorting for stability in intermediate chunks
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  return nodes;
}

// Global cancellation flag
let isCancelled = false;
let currentBuildId: string | undefined;

// Input validation helper
function validateInput(data: TreeBuilderMessage): { valid: boolean; error?: string } {
  if (data.type === 'BUILD_TREE') {
    if (!data.allFiles || !Array.isArray(data.allFiles)) {
      return { valid: false, error: 'allFiles must be an array' };
    }
    
    if (!data.id || typeof data.id !== 'string') {
      return { valid: false, error: 'id must be a string' };
    }
    
    if (data.chunkSize !== undefined) {
      if (typeof data.chunkSize !== 'number' || data.chunkSize <= 0 || !Number.isSafeInteger(data.chunkSize)) {
        return { valid: false, error: 'chunkSize must be a positive safe integer' };
      }
    }
    
    if (data.selectedFolder !== null && data.selectedFolder !== undefined && typeof data.selectedFolder !== 'string') {
      return { valid: false, error: 'selectedFolder must be string, null, or undefined' };
    }
    
    if (data.expandedNodes !== undefined && (typeof data.expandedNodes !== 'object' || data.expandedNodes === null)) {
      return { valid: false, error: 'expandedNodes must be an object' };
    }
    
    // Validate each file has a path
    for (const file of data.allFiles) {
      if (!file || typeof file.path !== 'string') {
        return { valid: false, error: 'Each file must have a path string' };
      }
    }
  }
  
  return { valid: true };
}

self.addEventListener('message', (e: MessageEvent<TreeBuilderMessage>) => {
  const data = e.data;
  
  // Handle different message types
  if (data.type === 'INIT') {
    self.postMessage({ type: 'READY' });
    return;
  }
  
  if (data.type === 'CANCEL') {
    if (data.id === currentBuildId) {
      isCancelled = true;
      self.postMessage({ type: 'CANCELLED', id: data.id });
    }
    return;
  }
  
  if (data.type !== 'BUILD_TREE') {
    return;
  }
  
  // Validate input
  const validation = validateInput(data);
  if (!validation.valid) {
    self.postMessage({
      type: 'TREE_ERROR',
      id: data.id,
      code: 'E_INVALID_INPUT',
      error: validation.error
    });
    return;
  }
  
  const { allFiles = [], chunkSize = UI.TREE.CHUNK_SIZE, selectedFolder, expandedNodes = {}, id = '' } = data;
  
  // Set current build ID and reset cancellation flag
  currentBuildId = id;
  isCancelled = false;
  
  try {
    // Build the complete file map
    const fileMap: TreeNodeMap = {};
    let processedCount = 0;

    // Use constants for throttling
    let lastPostTime = 0;
    let lastProgressPosted = -1;
    const POST_INTERVAL_MS = UI.TREE.PROGRESS_POST_INTERVAL_MS;
    const MIN_PROGRESS_DELTA = UI.TREE.PROGRESS_MIN_DELTA_PERCENT
    
    // Process files in chunks and send progress updates
    for (let i = 0; i < allFiles.length; i += chunkSize) {
      // Check for cancellation
      if (isCancelled) {
        return;
      }
      
      const batch = allFiles.slice(i, Math.min(i + chunkSize, allFiles.length));
      
      for (const file of batch) {
        if (!file.path) continue;
        
        const normalizedFilePath = normalizePath(file.path);
        const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';

        // Strictly include only files under selectedFolder (boundary-safe)
        let relativePath: string;
        if (selectedFolder) {
          const root = normalizedRootPath;
          const underRoot = normalizedFilePath === root || normalizedFilePath.startsWith(root + '/');
          if (!underRoot) {
            continue;
          }
          relativePath = normalizedFilePath === root ? '' : normalizedFilePath.slice(root.length + 1);
        } else {
          // Remove any leading slash to avoid empty first part
          relativePath = normalizedFilePath.replace(/^\/|^\\/, '');
        }

        const parts = relativePath.split('/');
        let currentPath = "";
        let current = fileMap;
        
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j];
          if (!part) continue;
          
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          if (j < parts.length - 1) {
            // Directory
            const dirPath = selectedFolder
              ? normalizePath(`${normalizedRootPath}/${currentPath}`)
              : normalizePath(`/${currentPath}`);

            if (!current[part]) {
              current[part] = {
                name: part,
                path: dirPath,
                children: {},
                isDirectory: true,
                isExpanded: expandedNodes[dirPath] ?? (j < 2)
              };
            }
            
            // Ensure children exists
            if (!current[part].children) {
              current[part].children = {};
            }
            
            current = current[part].children as TreeNodeMap;
          } else {
            // File
            const filePath = selectedFolder
              ? normalizePath(`${normalizedRootPath}/${currentPath}`)
              : normalizePath(`/${currentPath}`);

            current[part] = {
              name: part,
              path: filePath,
              isFile: true,
              fileData: file
            };
          }
        }
      }
      
      processedCount += batch.length;
      const progress = Math.min((processedCount / allFiles.length) * 100, 100);
      
      // Send intermediate chunk (unsorted for performance), throttled
      // Limit depth for intermediate updates to reduce payload size
      const now = Date.now();
      if ((now - lastPostTime) >= POST_INTERVAL_MS || (progress - lastProgressPosted) >= MIN_PROGRESS_DELTA || progress >= 100) {
        // Check for cancellation before posting
        if (isCancelled) {
          return;
        }
        
        lastPostTime = now;
        lastProgressPosted = progress;
        const intermediateNodes = convertToTreeNodes(fileMap, 0, false, UI.TREE.MAX_TRAVERSAL_DEPTH, false);
        self.postMessage({
          type: 'TREE_CHUNK',
          id,
          payload: {
            nodes: intermediateNodes,
            progress
          }
        });
      }
    }

    // Check for cancellation before final post
    if (isCancelled) {
      return;
    }
    
    // Send final tree (unsorted - sorting is handled centrally)
    const finalNodes = convertToTreeNodes(fileMap, 0, false, Number.POSITIVE_INFINITY, true);

    self.postMessage({
      type: 'TREE_COMPLETE',
      id,
      payload: {
        nodes: finalNodes,
        progress: 100
      }
    });
  } catch (error) {
    self.postMessage({
      type: 'TREE_ERROR',
      id,
      code: 'E_INTERNAL',
      error: error instanceof Error ? error.message : 'Unknown error building tree'
    });
  }
});