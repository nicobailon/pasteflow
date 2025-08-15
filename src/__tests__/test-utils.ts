import { FileData, TreeNode, SelectedFileReference } from '../types/file-types';

/**
 * Creates a mock FileData object with sensible defaults.
 * @param overrides - Partial FileData to override defaults
 * @returns Complete FileData object for testing
 */
export function createMockFileData(overrides: Partial<FileData> = {}): FileData {
  return {
    name: 'test-file.ts',
    path: '/test/test-file.ts',
    isDirectory: false,
    isContentLoaded: false,
    content: undefined,
    isBinary: false,
    isSkipped: false,
    size: 1024,
    ...overrides
  };
}

/**
 * Creates a mock TreeNode object with sensible defaults.
 * @param overrides - Partial TreeNode to override defaults
 * @returns Complete TreeNode object for testing
 */
export function createMockTreeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: 'node-1',
    name: 'test-node',
    type: 'file',
    path: '/test/test-node',
    level: 0,
    children: undefined,
    ...overrides
  };
}

/**
 * Creates a mock SelectedFileReference object.
 * @param overrides - Partial SelectedFileReference to override defaults
 * @returns Complete SelectedFileReference object for testing
 */
export function createMockSelectedFileReference(
  overrides: Partial<SelectedFileReference> = {}
): SelectedFileReference {
  return {
    path: '/test/selected-file.ts',
    lines: undefined,
    ...overrides
  };
}

/**
 * Creates a mock directory structure for testing file tree operations.
 * @param depth - How deep the tree should be
 * @param filesPerDir - Number of files in each directory
 * @returns Root TreeNode with nested structure
 */
export function createMockFileTree(depth: number = 2, filesPerDir: number = 3): TreeNode {
  const createLevel = (currentDepth: number, parentPath: string): TreeNode[] => {
    if (currentDepth === 0) {
      return Array.from({ length: filesPerDir }, (_, i) => ({
        id: `${parentPath}-file-${i}`,
        name: `file-${i}.ts`,
        type: 'file' as const,
        path: `${parentPath}/file-${i}.ts`,
        level: currentDepth + 1
      }));
    }

    const nodes: TreeNode[] = [];
    
    // Add directories
    for (let i = 0; i < 2; i++) {
      const dirName = `dir-${i}`;
      const dirPath = `${parentPath}/${dirName}`;
      nodes.push({
        id: `${parentPath}-${dirName}`,
        name: dirName,
        type: 'directory' as const,
        path: dirPath,
        level: depth - currentDepth + 1,
        children: createLevel(currentDepth - 1, dirPath)
      });
    }
    
    // Add files
    for (let i = 0; i < filesPerDir; i++) {
      nodes.push({
        id: `${parentPath}-file-${i}`,
        name: `file-${i}.ts`,
        type: 'file' as const,
        path: `${parentPath}/file-${i}.ts`,
        level: depth - currentDepth + 1
      });
    }
    
    return nodes;
  };

  return {
    id: 'root',
    name: 'root',
    type: 'directory',
    path: '/root',
    level: 0,
    children: createLevel(depth, '/root')
  };
}

/**
 * Creates a batch of mock FileData objects.
 * @param count - Number of files to create
 * @param baseOverrides - Base overrides to apply to all files
 * @returns Array of FileData objects
 */
export function createMockFileDataBatch(
  count: number,
  baseOverrides: Partial<FileData> = {}
): FileData[] {
  return Array.from({ length: count }, (_, i) =>
    createMockFileData({
      name: `file-${i}.ts`,
      path: `/test/file-${i}.ts`,
      ...baseOverrides
    })
  );
}

/**
 * Creates mock expanded nodes record for testing tree expansion state.
 * @param nodeIds - Array of node IDs to mark as expanded
 * @returns Record of node IDs to boolean expansion state
 */
export function createMockExpandedNodes(nodeIds: string[]): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  nodeIds.forEach(id => {
    expanded[id] = true;
  });
  return expanded;
}

/**
 * Helper to wait for async operations in tests.
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the specified time
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock Worker for testing worker pool functionality.
 * @param responseDelay - Delay before sending response (ms)
 * @returns Mock Worker instance
 */
export function createMockWorker(responseDelay: number = 0): Worker {
  const worker = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent) => void) | null
  };

  // Simulate worker ready message
  worker.addEventListener.mockImplementation((event: string, handler: Function) => {
    if (event === 'message') {
      setTimeout(() => {
        handler({ data: { type: 'READY' } });
      }, responseDelay);
    }
  });

  return worker as unknown as Worker;
}

/**
 * Response handler type for IPC channels
 */
type IPCResponse<T = unknown> = T | ((...args: unknown[]) => T | Promise<T>);

/**
 * Creates a mock IPC handler for Electron testing.
 * @param responses - Map of channel names to response values
 * @returns Mock IPC handler function
 */
export function createMockIPCHandler<T = unknown>(
  responses: Map<string, IPCResponse<T>> = new Map()
): jest.Mock {
  return jest.fn((channel: string, ...args: unknown[]) => {
    if (responses.has(channel)) {
      const response = responses.get(channel);
      return typeof response === 'function' 
        ? (response as (...args: unknown[]) => T | Promise<T>)(...args) 
        : response;
    }
    return Promise.resolve(null);
  });
}

/**
 * Asserts that a value is defined (not null or undefined).
 * Useful for TypeScript type narrowing in tests.
 * @param value - Value to check
 * @param message - Optional error message
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected value to be defined');
  }
}

/**
 * Creates a mock cache for directory selection states.
 * @param initialStates - Initial cache states
 * @returns Mock DirectorySelectionCache
 */
export function createMockSelectionCache(
  initialStates: Map<string, 'full' | 'partial' | 'none'> = new Map()
) {
  const cache = new Map(initialStates);
  
  return {
    get: jest.fn((path: string) => cache.get(path) || 'none'),
    set: jest.fn((path: string, state: 'full' | 'partial' | 'none') => {
      cache.set(path, state);
    }),
    bulkUpdate: jest.fn((updates: Map<string, 'full' | 'partial' | 'none'>) => {
      updates.forEach((state, path) => cache.set(path, state));
    }),
    clear: jest.fn(() => cache.clear())
  };
}