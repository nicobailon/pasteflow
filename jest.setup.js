// Import jest-dom matchers
require('@testing-library/jest-dom');

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Clock: () => null,
  SortAsc: () => null,
  GripVertical: () => null,
  ChevronRight: () => null,
  ChevronDown: () => null,
  Folder: () => null,
  FolderOpen: () => null,
  File: () => null,
  FileText: () => null,
  Code: () => null,
  FileCode: () => null,
  FileJson: () => null,
  Image: () => null,
  Film: () => null,
  Music: () => null,
  Archive: () => null,
  Copy: () => null,
  Check: () => null,
  X: () => null,
  Plus: () => null,
  Minus: () => null,
  Settings: () => null,
  Search: () => null,
  Filter: () => null,
  Download: () => null,
  Upload: () => null,
  Save: () => null,
  Trash: () => null,
  Edit: () => null,
  Eye: () => null,
  EyeOff: () => null,
  RefreshCw: () => null,
  AlertCircle: () => null,
  Info: () => null,
  HelpCircle: () => null,
  Terminal: () => null,
  Zap: () => null,
  Package: () => null,
  Layers: () => null,
  Hash: () => null
}));

// Mock import.meta for ES module compatibility
if (typeof global !== 'undefined' && !global.import) {
  global.import = {
    meta: {
      url: 'file:///mock/path/to/file.js'
    }
  };
}

// Mock Worker for worker pool tests
if (typeof Worker === 'undefined') {
  global.Worker = class MockWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();
      
      // Simulate worker initialization
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { data: { type: 'READY' } }));
      }, 0);
    }
    
    postMessage(data) {
      // Mock implementation
    }
    
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(listener);
    }
    
    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }
    
    dispatchEvent(event) {
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        listeners.forEach(listener => listener(event));
      }
    }
    
    terminate() {
      this.listeners.clear();
    }
  };
  
  // Mock MessageEvent
  global.MessageEvent = class MessageEvent {
    constructor(type, init) {
      this.type = type;
      this.data = init?.data;
    }
  };
}

// Polyfill TextEncoder/TextDecoder for Jest environment
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class {
    encode(input) {
      const bytes = [];
      for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        if (char < 0x80) {
          bytes.push(char);
        } else if (char < 0x800) {
          bytes.push(0xc0 | (char >> 6), 0x80 | (char & 0x3f));
        } else if (char < 0xd800 || char >= 0xe000) {
          bytes.push(0xe0 | (char >> 12), 0x80 | ((char >> 6) & 0x3f), 0x80 | (char & 0x3f));
        } else {
          // Handle surrogate pairs
          i++;
          const char2 = input.charCodeAt(i);
          const codePoint = 0x10000 + (((char & 0x3ff) << 10) | (char2 & 0x3ff));
          bytes.push(
            0xf0 | (codePoint >> 18),
            0x80 | ((codePoint >> 12) & 0x3f),
            0x80 | ((codePoint >> 6) & 0x3f),
            0x80 | (codePoint & 0x3f)
          );
        }
      }
      return new Uint8Array(bytes);
    }
  };
}

if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = class {
    decode(bytes) {
      let result = '';
      let i = 0;
      while (i < bytes.length) {
        const byte = bytes[i];
        if (byte < 0x80) {
          result += String.fromCharCode(byte);
          i++;
        } else if ((byte & 0xe0) === 0xc0) {
          result += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
          i += 2;
        } else if ((byte & 0xf0) === 0xe0) {
          result += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
          i += 3;
        } else {
          const codePoint = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
          const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
          const low = ((codePoint - 0x10000) % 0x400) + 0xdc00;
          result += String.fromCharCode(high, low);
          i += 4;
        }
      }
      return result;
    }
  };
}

// Mock the window.electron object
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      send: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      invoke: jest.fn().mockImplementation((channel, data) => {
        // Workspace operations
        if (channel === '/workspace/list') {
          return Promise.resolve([]);
        }
        if (channel === '/workspace/load') {
          return Promise.resolve(null);
        }
        if (channel === '/workspace/create') {
          return Promise.resolve();
        }
        if (channel === '/workspace/update') {
          return Promise.resolve();
        }
        if (channel === '/workspace/delete') {
          return Promise.resolve();
        }
        if (channel === '/workspace/touch') {
          return Promise.resolve();
        }
        if (channel === '/workspace/rename') {
          return Promise.resolve();
        }
        
        // Instructions operations
        if (channel === '/instructions/list') {
          return Promise.resolve([]);
        }
        if (channel === '/instructions/create') {
          return Promise.resolve();
        }
        if (channel === '/instructions/update') {
          return Promise.resolve();
        }
        if (channel === '/instructions/delete') {
          return Promise.resolve();
        }
        
        // Preferences operations
        if (channel === '/prefs/get') {
          return Promise.resolve(null);
        }
        if (channel === '/prefs/set') {
          return Promise.resolve();
        }
        
        // File operations
        if (channel === 'request-file-content') {
          return Promise.resolve({
            success: false,
            error: 'Mock: File content not available in test environment'
          });
        }
        
        // Default response for unknown channels
        console.warn(`Mock: Unhandled IPC channel: ${channel}`);
        return Promise.resolve(null);
      })
    }
  },
  writable: true,
  configurable: true
});

// Mock document.getElementById for React 18 createRoot
document.getElementById = jest.fn().mockImplementation(() => {
  const div = document.createElement('div');
  div.id = 'root';
  document.body.append(div);
  return div;
});

// Mock window.matchMedia for theme support
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn()
};
global.localStorage = localStorageMock;

// Mock for main.tsx
jest.mock('./src/main.tsx', () => ({}), { virtual: true });

// Import and configure worker environment
const { setupWorkerEnvironment, configureWorkerMocks } = require('./src/__tests__/setup/jest-worker-setup');

// Setup with faster defaults for testing
setupWorkerEnvironment();
configureWorkerMocks({
  autoRespond: true,
  responseDelay: 1, // Reduce from 10ms to 1ms
  initDelay: 1,     // Reduce from 5ms to 1ms
  failureRate: 0
}); 