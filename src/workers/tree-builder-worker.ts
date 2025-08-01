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
  return path.replace(/\\/g, '/');
}

// Convert hierarchical map to TreeNode array
function convertToTreeNodes(nodeMap: TreeNodeMap, depth = 0, shouldSort = true): TreeNode[] {
  const nodes: TreeNode[] = [];
  
  for (const key in nodeMap) {
    const node = nodeMap[key];
    
    if (node.isFile) {
      nodes.push({
        name: node.name,
        path: node.path,
        type: 'file',
        depth,
        fileData: node.fileData
      });
    } else if (node.isDirectory) {
      const treeNode: TreeNode = {
        name: node.name,
        path: node.path,
        type: 'directory',
        depth,
        isExpanded: node.isExpanded ?? false
      };
      
      if (node.children && Object.keys(node.children).length > 0) {
        treeNode.children = convertToTreeNodes(node.children, depth + 1, shouldSort);
      }
      
      nodes.push(treeNode);
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
    
    // Process files in chunks and send progress updates
    for (let i = 0; i < allFiles.length; i += chunkSize) {
      const batch = allFiles.slice(i, Math.min(i + chunkSize, allFiles.length));
      
      for (const file of batch) {
        if (!file.path) continue;
        
        const normalizedFilePath = normalizePath(file.path);
        const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';
        
        const relativePath = 
          selectedFolder && normalizedFilePath.startsWith(normalizedRootPath)
            ? normalizedFilePath
                .slice(normalizedRootPath.length)
                .replace(/^\/|^\\/, "")
            : normalizedFilePath;
        
        const parts = relativePath.split(/[/\\]/);
        let currentPath = "";
        let current = fileMap;
        
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j];
          if (!part) continue;
          
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          if (j < parts.length - 1) {
            // Directory
            const dirPath = selectedFolder
              ? normalizePath(`${selectedFolder}/${currentPath}`)
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
            
            current = current[part].children;
          } else {
            // File
            const filePath = selectedFolder
              ? normalizePath(`${selectedFolder}/${currentPath}`)
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
      
      // Send intermediate chunk (unsorted for performance)
      const intermediateNodes = convertToTreeNodes(fileMap, 0, false);
      
      self.postMessage({
        type: 'TREE_CHUNK',
        id,
        payload: {
          nodes: intermediateNodes,
          progress
        }
      });
    }
    
    // Send final sorted tree
    const finalNodes = convertToTreeNodes(fileMap, 0, true);
    
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