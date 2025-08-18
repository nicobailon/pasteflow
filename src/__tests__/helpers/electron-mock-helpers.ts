import { WorkspaceState, DatabaseWorkspace, Instruction } from '../../types/workspace-types';
import { TOKEN_COUNTING } from '../../constants/app-constants';

// Define precise types for IPC channels and their data/response types
type WorkspaceChannels = {
  '/workspace/list': { data: undefined; response: DatabaseWorkspace[] };
  '/workspace/load': { data: { id: string }; response: WorkspaceState | null };
  '/workspace/create': { data: { name: string; state: WorkspaceState }; response: void };
  '/workspace/update': { data: { id: string; state: WorkspaceState }; response: void };
  '/workspace/delete': { data: { id: string }; response: void };
  '/workspace/touch': { data: { id: string }; response: void };
  '/workspace/rename': { data: { id: string; name: string }; response: void };
};

type InstructionChannels = {
  '/instructions/list': { data: undefined; response: Instruction[] };
  '/instructions/create': { data: { name: string; content: string }; response: void };
  '/instructions/update': { data: { id: string; name?: string; content?: string }; response: void };
  '/instructions/delete': { data: { id: string }; response: void };
};

type PreferenceChannels = {
  '/prefs/get': { data: { key: string }; response: unknown };
  '/prefs/set': { data: { key: string; value: unknown }; response: void };
};

type FileChannels = {
  'request-file-content': { 
    data: { filePath: string }; 
    response: { success: boolean; content: string; tokenCount: number } 
  };
};

type AllChannels = WorkspaceChannels & InstructionChannels & PreferenceChannels & FileChannels;
type ChannelName = keyof AllChannels;

export interface ElectronMockConfig {
  workspaces?: Array<DatabaseWorkspace>;
  instructions?: Array<Instruction>;
  preferences?: Record<string, unknown>;
  fileContentResponses?: Map<string, { content: string; tokenCount: number }>;
}

type ChannelData<T extends ChannelName> = AllChannels[T]['data'];
type ChannelResponse<T extends ChannelName> = AllChannels[T]['response'];

export function setupElectronMocks(config: ElectronMockConfig = {}) {
  const {
    workspaces = [],
    instructions = [],
    preferences = {},
    fileContentResponses = new Map()
  } = config;

  // Reset the mock with precise typing
  const mockInvoke = jest.fn().mockImplementation(<T extends ChannelName>(
    channel: T, 
    data?: ChannelData<T>
  ): Promise<ChannelResponse<T>> => {
    // Workspace operations
    if (channel === '/workspace/list') {
      return Promise.resolve(workspaces) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/load') {
      const loadData = data as ChannelData<'/workspace/load'>;
      if (loadData?.id) {
        const workspace = workspaces.find(w => w.id === loadData.id);
        return Promise.resolve(workspace ? JSON.parse(workspace.state) : null) as Promise<ChannelResponse<T>>;
      }
      return Promise.resolve(null) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/create') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/update') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/delete') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/touch') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/workspace/rename') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }

    // Instructions operations
    if (channel === '/instructions/list') {
      return Promise.resolve(instructions) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/instructions/create') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/instructions/update') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/instructions/delete') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }

    // Preferences operations
    if (channel === '/prefs/get') {
      const prefsData = data as ChannelData<'/prefs/get'>;
      if (prefsData?.key) {
        return Promise.resolve(preferences[prefsData.key] ?? null) as Promise<ChannelResponse<T>>;
      }
      return Promise.resolve(null) as Promise<ChannelResponse<T>>;
    }
    if (channel === '/prefs/set') {
      return Promise.resolve(undefined) as Promise<ChannelResponse<T>>;
    }

    // File operations
    if (channel === 'request-file-content') {
      const fileData = data as ChannelData<'request-file-content'>;
      if (fileData?.filePath) {
        const response = fileContentResponses.get(fileData.filePath);
        if (response) {
          return Promise.resolve({
            success: true,
            content: response.content,
            tokenCount: response.tokenCount
          }) as Promise<ChannelResponse<T>>;
        }
        return Promise.resolve({
          success: true,
          content: `// Mock content for ${fileData.filePath}`,
          tokenCount: 100
        }) as Promise<ChannelResponse<T>>;
      }
      return Promise.resolve({
        success: false,
        content: '',
        tokenCount: 0
      }) as Promise<ChannelResponse<T>>;
    }

    // Default response
    return Promise.resolve(null) as Promise<ChannelResponse<T>>;
  });

  // Update the window.electron mock
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.invoke = mockInvoke;
  }

  return mockInvoke;
}

export function createMockWorkspace(overrides?: Partial<WorkspaceState>): DatabaseWorkspace {
  const defaultState: WorkspaceState = {
    selectedFolder: '/mock/folder',
    selectedFiles: [],
    expandedNodes: [],
    userInstructions: '',
    customPrompts: [],
    fileExclusionPatterns: [],
    systemPrompts: [],
    currentInstructionId: null,
    additionalContext: '',
    showSelectedFilesOnly: false,
    fileSortMode: 'alphabetical',
    treeMode: 'none',
    searchQuery: '',
    showLineNumbers: true,
    shouldWrapText: false,
    showTokenCount: true,
    showClipboardButton: true,
    theme: 'light',
    editorFontSize: 14
  };

  const state = { ...defaultState, ...overrides };

  return {
    id: Math.random().toString(36).substr(2, 9),
    name: overrides?.selectedFolder?.split('/').pop() || 'Mock Workspace',
    state: JSON.stringify(state),
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString()
  };
}

export function createMockInstruction(overrides?: Partial<Instruction>): Instruction {
  const defaultInstruction: Instruction = {
    id: Math.random().toString(36).substr(2, 9),
    name: 'Mock Instruction',
    content: 'This is a mock instruction',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return { ...defaultInstruction, ...overrides };
}

export function resetElectronMocks() {
  if (window.electron?.ipcRenderer?.invoke) {
    (window.electron.ipcRenderer.invoke as jest.Mock).mockClear();
  }
  if (window.electron?.ipcRenderer?.send) {
    (window.electron.ipcRenderer.send as jest.Mock).mockClear();
  }
  if (window.electron?.ipcRenderer?.on) {
    (window.electron.ipcRenderer.on as jest.Mock).mockClear();
  }
  if (window.electron?.ipcRenderer?.removeListener) {
    (window.electron.ipcRenderer.removeListener as jest.Mock).mockClear();
  }
}

export function getMockFileContent(filePath: string): { content: string; tokenCount: number } {
  const extension = filePath.split('.').pop() || '';
  const mockContents: Record<string, string> = {
    'ts': `// TypeScript file: ${filePath}\nexport function mockFunction() {\n  return 'mock';\n}`,
    'tsx': `// React component: ${filePath}\nimport React from 'react';\nexport const MockComponent = () => <div>Mock</div>;`,
    'js': `// JavaScript file: ${filePath}\nfunction mockFunction() {\n  return 'mock';\n}`,
    'jsx': `// React component: ${filePath}\nimport React from 'react';\nexport const MockComponent = () => <div>Mock</div>;`,
    'json': `{\n  "mock": true,\n  "file": "${filePath}"\n}`,
    'md': `# Mock Markdown\n\nThis is mock content for ${filePath}`,
    'txt': `Mock text content for ${filePath}`
  };

  const content = mockContents[extension] || `Mock content for ${filePath}`;
  const tokenCount = Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN); // Rough approximation

  return { content, tokenCount };
}