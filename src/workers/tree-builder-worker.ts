import type { FileData, TreeNode } from '../types/file-types';
import { UI } from '@constants';
import { normalizePath } from '@file-ops/path';

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


// Convert hierarchical map to TreeNode array
// maxDepth limits how deep to include children (use Infinity for full depth)
// When respectExpansion is true, include children for all expanded nodes regardless of depth
function convertToTreeNodes(
  nodeMap: TreeNodeMap,
  level = 0,
  shouldSort = false, // Sorting is now handled by the centralized service
  maxDepth: number = Number.POSITIVE_INFINITY,
  includeFileData = true,
  respectExpansion = false
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
      // Include children if:
      // 1. We're respecting expansion and the node is expanded, OR
      // 2. We're within the max depth limit
      const shouldIncludeChildren = node.children && Object.keys(node.children).length > 0 && 
        (respectExpansion ? node.isExpanded : (level + 1 < maxDepth));
      
      const treeNode: TreeNode = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'directory',
        level,
        isExpanded: node.isExpanded ?? false,
        children: shouldIncludeChildren && node.children
          ? convertToTreeNodes(node.children, level + 1, shouldSort, 
              respectExpansion ? Number.POSITIVE_INFINITY : maxDepth, 
              includeFileData, respectExpansion)
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

// Process a single file and add it to the tree map
function processFileIntoMap(
  file: FileData,
  fileMap: TreeNodeMap,
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>
): void {
  if (!file.path) return;
  
  const normalizedFilePath = normalizePath(file.path);
  const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';

  // Strictly include only files under selectedFolder (boundary-safe)
  let relativePath: string;
  if (selectedFolder) {
    const root = normalizedRootPath;
    const underRoot = normalizedFilePath === root || normalizedFilePath.startsWith(root + '/');
    if (!underRoot) {
      return;
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
          isExpanded: expandedNodes[dirPath] ?? (j < UI.TREE.DEFAULT_EXPANSION_LEVEL)
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

// Process a batch of files and send progress update if needed
function processBatchAndSendProgress(
  batch: FileData[],
  fileMap: TreeNodeMap,
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>,
  processedCount: number,
  totalFiles: number,
  id: string,
  lastPostTime: number,
  lastProgressPosted: number
): { newProcessedCount: number; newLastPostTime: number; newLastProgressPosted: number } {
  for (const file of batch) {
    processFileIntoMap(file, fileMap, selectedFolder, expandedNodes);
  }
  
  const newProcessedCount = processedCount + batch.length;
  const progress = Math.min((newProcessedCount / totalFiles) * 100, 100);
  
  // Send intermediate chunk (unsorted for performance), throttled
  const now = Date.now();
  const shouldPost = (now - lastPostTime) >= UI.TREE.PROGRESS_POST_INTERVAL_MS || 
                     (progress - lastProgressPosted) >= UI.TREE.PROGRESS_MIN_DELTA_PERCENT || 
                     progress >= 100;
  
  if (shouldPost) {
    // Check for cancellation before posting
    if (!isCancelled) {
      // Use respectExpansion=true for intermediate chunks to show all expanded folders
      const intermediateNodes = convertToTreeNodes(fileMap, 0, false, UI.TREE.MAX_TRAVERSAL_DEPTH, false, true);
      self.postMessage({
        type: 'TREE_CHUNK',
        id,
        payload: {
          nodes: intermediateNodes,
          progress
        }
      });
    }
    return { 
      newProcessedCount, 
      newLastPostTime: now, 
      newLastProgressPosted: progress 
    };
  }
  
  return { 
    newProcessedCount, 
    newLastPostTime: lastPostTime, 
    newLastProgressPosted: lastProgressPosted 
  };
}

// Build the tree from files
function buildTree(
  allFiles: FileData[],
  chunkSize: number,
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>,
  id: string
): void {
  const fileMap: TreeNodeMap = {};
  let processedCount = 0;
  let lastPostTime = 0;
  let lastProgressPosted = -1;
  
  // Process files in chunks and send progress updates
  for (let i = 0; i < allFiles.length; i += chunkSize) {
    // Check for cancellation
    if (isCancelled) {
      return;
    }
    
    const batch = allFiles.slice(i, Math.min(i + chunkSize, allFiles.length));
    
    const result = processBatchAndSendProgress(
      batch,
      fileMap,
      selectedFolder,
      expandedNodes,
      processedCount,
      allFiles.length,
      id,
      lastPostTime,
      lastProgressPosted
    );
    
    processedCount = result.newProcessedCount;
    lastPostTime = result.newLastPostTime;
    lastProgressPosted = result.newLastProgressPosted;
  }

  // Check for cancellation before final post
  if (isCancelled) {
    return;
  }
  
  // Send final tree (unsorted - sorting is handled centrally)
  const finalNodes = convertToTreeNodes(fileMap, 0, false, Number.POSITIVE_INFINITY, true, false);

  self.postMessage({
    type: 'TREE_COMPLETE',
    id,
    payload: {
      nodes: finalNodes,
      progress: 100
    }
  });
}

// Input validation helper
function validateInput(data: TreeBuilderMessage): { valid: boolean; error?: string } {
  if (data.type === 'BUILD_TREE') {
    if (!data.allFiles || !Array.isArray(data.allFiles)) {
      return { valid: false, error: 'allFiles must be an array' };
    }
    
    if (!data.id || typeof data.id !== 'string') {
      return { valid: false, error: 'id must be a string' };
    }
    
    if (data.chunkSize !== undefined && (typeof data.chunkSize !== 'number' || data.chunkSize <= 0 || !Number.isSafeInteger(data.chunkSize))) {
        return { valid: false, error: 'chunkSize must be a positive safe integer' };
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

// Handle initialization message
function handleInitMessage(): void {
  self.postMessage({ type: 'INIT_COMPLETE' });
}

// Handle cancellation message
function handleCancelMessage(id: string | undefined): void {
  if (id === currentBuildId) {
    isCancelled = true;
    self.postMessage({ type: 'CANCELLED', id });
  }
}

// Handle build tree message
function handleBuildTreeMessage(data: TreeBuilderMessage): void {
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
    buildTree(allFiles, chunkSize, selectedFolder || null, expandedNodes, id);
  } catch (error) {
    self.postMessage({
      type: 'TREE_ERROR',
      id,
      code: 'E_INTERNAL',
      error: error instanceof Error ? error.message : 'Unknown error building tree'
    });
  }
}

// Send initial ready signal when worker loads
self.postMessage({ type: 'READY' });

self.addEventListener('message', (e: MessageEvent<TreeBuilderMessage>) => {
  const data = e.data;
  
  // Handle different message types
  if (data.type === 'INIT') {
    handleInitMessage();
    return;
  }
  
  if (data.type === 'CANCEL') {
    handleCancelMessage(data.id);
    return;
  }
  
  if (data.type === 'BUILD_TREE') {
    handleBuildTreeMessage(data);
  }
});