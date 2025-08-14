import type { FileData, TreeNode } from '../types/file-types';

interface TreeBuilderMessage {
  allFiles: FileData[];
  chunkSize?: number;
  selectedFolder?: string | null;
  expandedNodes?: Record<string, boolean>;
  id: string;
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
  shouldSort = true,
  maxDepth: number = Number.POSITIVE_INFINITY,
  includeFileData: boolean = true
): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const key in nodeMap) {
    const node = nodeMap[key];

    if (node.isFile) {
      const fileNode: Partial<TreeNode> = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'file',
        level,
      };
      if (includeFileData) {
        (fileNode as any).fileData = node.fileData;
      }
      nodes.push(fileNode as TreeNode);
    } else if (node.isDirectory) {
      const treeNode: Partial<TreeNode> = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'directory',
        level,
        isExpanded: node.isExpanded ?? false
      };

      // Only include children if we haven't reached maxDepth
      if (level + 1 < maxDepth && node.children && Object.keys(node.children).length > 0) {
        (treeNode as any).children = convertToTreeNodes(node.children, level + 1, shouldSort, maxDepth, includeFileData);
      }

      nodes.push(treeNode as TreeNode);
    }
  }

  if (shouldSort) {
    // Basic alphabetical sorting - directories first, then files
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  return nodes;
}

self.addEventListener('message', (e: MessageEvent<TreeBuilderMessage>) => {
  const { allFiles, chunkSize = 500, selectedFolder, expandedNodes = {}, id } = e.data;
  
  try {
    // Build the complete file map
    const fileMap: TreeNodeMap = {};
    let processedCount = 0;

    // Throttle intermediate posts to reduce main-thread work
    let lastPostTime = 0;
    let lastProgressPosted = -1;
    const POST_INTERVAL_MS = 50;
    const MIN_PROGRESS_DELTA = 5; // percent
    
    // Process files in chunks and send progress updates
    for (let i = 0; i < allFiles.length; i += chunkSize) {
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
        lastPostTime = now;
        lastProgressPosted = progress;
        const intermediateNodes = convertToTreeNodes(fileMap, 0, false, 3, false);
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

    // Send final sorted tree (full depth, include fileData)
    const finalNodes = convertToTreeNodes(fileMap, 0, true, Number.POSITIVE_INFINITY, true);

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
      error: error instanceof Error ? error.message : 'Unknown error building tree'
    });
  }
});