import type { FileData, TreeNode } from '../../types/file-types';
import { normalizePath } from '../../file-ops/path';
import { buildTreeNodesFromMap } from '../../utils/tree-node-transform';

type StartReq = {
  files: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  chunkSize?: number;
};

type Chunk = { nodes: TreeNode[]; progress: number };
type Done = { nodes: TreeNode[]; progress: number };

type TreeDirectoryNode = {
  name: string;
  path: string;
  children: Record<string, TreeDirectoryNode | TreeFileNode>;
  isDirectory: true;
  isExpanded: boolean;
};

type TreeFileNode = {
  name: string;
  path: string;
  isFile: true;
  fileData: FileData;
};

type TreeMapNode = TreeDirectoryNode | TreeFileNode;
type TreeMap = Record<string, TreeMapNode>;

function buildTreeMap(
  files: FileData[],
  selectedFolder: string | null,
  expandedNodes: Record<string, boolean>
): TreeMap {
  const fileMap: TreeMap = {};
  const normalizedRoot = selectedFolder ? normalizePath(selectedFolder) : '';

  const inScope = (abs: string) => {
    if (!selectedFolder) return true;
    return abs === normalizedRoot || abs.startsWith(normalizedRoot + '/');
  };

  const ensureDir = (
    map: TreeMap,
    absPath: string,
    parts: string[],
    depth: number
  ): { map: TreeMap; dirNode: TreeDirectoryNode } => {
    let current: TreeMap = map;
    let currentPath = '';
    let dirNode: TreeDirectoryNode | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const partAbs = selectedFolder
        ? normalizePath(`${normalizedRoot}/${currentPath}`)
        : normalizePath(`/${currentPath}`);

      if (!current[part]) {
        current[part] = {
          name: part,
          path: partAbs,
          children: {},
          isDirectory: true as const,
          isExpanded: expandedNodes[partAbs] ?? (i < 2),
        };
      } else {
        // Coerce to directory if a file was created earlier at same key
        const existing = current[part] as TreeMapNode;
        if (!('children' in existing)) {
          // Convert file node to directory node
          const dirNode: TreeDirectoryNode = {
            name: existing.name,
            path: existing.path,
            children: {},
            isDirectory: true as const,
            isExpanded: expandedNodes[partAbs] ?? (i < 2)
          };
          current[part] = dirNode;
        } else {
          // Update existing directory node's expansion state
          const dirNode = existing as TreeDirectoryNode;
          dirNode.isExpanded = expandedNodes[partAbs] ?? (dirNode.isExpanded ?? (i < 2));
        }
      }

      dirNode = current[part] as TreeDirectoryNode;
      current = dirNode.children;
    }

    return { map, dirNode: dirNode! };
  };

  for (const f of files) {
    if (!f.path) continue;
    const abs = normalizePath(f.path);
    if (!inScope(abs)) continue;

    const relative = selectedFolder
      ? abs === normalizedRoot
        ? ''
        : abs.slice(normalizedRoot.length + 1)
      : abs.replace(/^\/|^\\/, '');

    const parts = relative.split('/').filter(Boolean);

    // Directory entries: create directory nodes even if empty
    if (f.isDirectory) {
      if (parts.length === 0) {
        // Selected folder itself - nothing to add
        continue;
      }
      ensureDir(fileMap, abs, parts, parts.length);
      continue;
    }

    // File entries: ensure parent directories, then add file node
    if (parts.length === 0) {
      // Defensive: a file equal to root shouldn't happen; skip
      continue;
    }

    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];

    if (dirParts.length > 0) {
      ensureDir(fileMap, abs, dirParts, dirParts.length);
    }

    const parentPath = dirParts.join('/');
    let parentMap: TreeMap = fileMap;
    if (dirParts.length > 0) {
      // Walk again to locate the parent children map
      let current: TreeMap = fileMap;
      let curPath = '';
      for (const part of dirParts) {
        curPath = curPath ? `${curPath}/${part}` : part;
        const node = current[part] as TreeDirectoryNode;
        parentMap = node.children;
        current = node.children;
      }
    }

    const fileAbs = selectedFolder
      ? normalizePath(`${normalizedRoot}/${dirParts.length ? `${parentPath}/${fileName}` : fileName}`)
      : normalizePath(`/${dirParts.length ? `${parentPath}/${fileName}` : fileName}`);

    parentMap[fileName] = {
      name: fileName,
      path: fileAbs,
      isFile: true as const,
      fileData: f,
    };
  }

  return fileMap;
}

class MockTreeBuilderWorkerPool {
  startStreaming(
    req: StartReq,
    callbacks: {
      onChunk: (chunk: Chunk) => void;
      onComplete: (done: Done) => void;
      onError: (error: Error) => void;
    }
  ): { cancel: () => Promise<void> } {
    let cancelled = false;

    try {
      const map = buildTreeMap(req.files, req.selectedFolder, req.expandedNodes);
      const deps = {
        // Force default collapsed in tests; flattenTree will respect req.expandedNodes
        expandedLookup: (_path: string) => false,
        sortOrder: 'default',
      };
      const nodes = buildTreeNodesFromMap(
        map,
        0,
        deps,
        Number.POSITIVE_INFINITY
      );

      // Synchronous callbacks for deterministic tests
      if (!cancelled) {
        callbacks.onChunk({ nodes, progress: 50 });
      }
      if (!cancelled) {
        callbacks.onComplete({ nodes, progress: 100 });
      }

      return {
        cancel: async () => {
          cancelled = true;
        },
      };
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error('Mock pool error'));
      return { cancel: async () => {} };
    }
  }
}

let singleton: MockTreeBuilderWorkerPool | null = null;

export function getTreeBuilderWorkerPool(): MockTreeBuilderWorkerPool {
  if (!singleton) {
    singleton = new MockTreeBuilderWorkerPool();
  }
  return singleton;
}

export function resetTreeBuilderWorkerPool(): void {
  singleton = null;
}