import '@testing-library/jest-dom';

/**
* Notes on type assertions in this test setup:
* - JSDOM/Electron test globals are not fully typed; localized assertions are used when assigning polyfills.
* - Default generics prefer `unknown` over `any` to retain type safety where possible.
*/
// Robust CustomEvent poly that extends Event to ensure dispatchEvent accepts it
(() => {
 if (typeof window !== 'undefined') {
   class CustomEventPoly<T = unknown> extends Event {
     detail: T;
     constructor(type: string, params?: CustomEventInit<T>) {
       super(type, params);
       this.detail = (params?.detail as T);
     }
   }
   (window as unknown as { CustomEvent: unknown }).CustomEvent = CustomEventPoly as unknown as typeof CustomEvent;
 }
})();

// Mock import.meta for ES module compatibility
if (typeof global !== 'undefined' && !(global as any).import) {
  (global as any).import = {
    meta: {
      url: 'file:///mock/path/to/file.js',
    },
  };
}

// Mock Worker for worker pool tests
if (typeof (global as any).Worker === 'undefined') {
  class MockMessageEvent<T = unknown> extends Event {
    data: T;
    constructor(type: string, init?: { data?: T }) {
      super(type);
      this.data = init?.data as T;
    }
  }
  (global as unknown as { MessageEvent: unknown }).MessageEvent = MockMessageEvent as unknown as typeof MessageEvent;

  class MockWorker {
    url: string | URL;
    options?: WorkerOptions;
    listeners: Map<string, Function[]>;

    constructor(url: string | URL, options?: WorkerOptions) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();

      // Simulate worker initialization
      setTimeout(() => {
        this.dispatchEvent(new MockMessageEvent('message', { data: { type: 'READY' } }));
      }, 0);
    }

    postMessage(_data: unknown) {
      // Mock implementation
    }

    addEventListener(type: string, listener: any) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type)!.push(listener);
    }

    removeEventListener(type: string, listener: any) {
      const listeners = this.listeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }

    dispatchEvent(event: { type: string; data?: any }) {
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        listeners.forEach((listener) => listener(event));
      }
    }

    terminate() {
      this.listeners.clear();
    }
  }

  (global as any).Worker = MockWorker as any;
}

// Polyfill TextEncoder/TextDecoder for Jest environment
if (typeof (global as any).TextEncoder === 'undefined') {
  (global as any).TextEncoder = class {
    encode(input: string) {
      const bytes: number[] = [];
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
            0x80 | (codePoint & 0x3f),
          );
        }
      }
      return new Uint8Array(bytes);
    }
  };
}

if (typeof (global as any).TextDecoder === 'undefined') {
  (global as any).TextDecoder = class {
    decode(bytes: Uint8Array) {
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
          const codePoint =
            ((byte & 0x07) << 18) |
            ((bytes[i + 1] & 0x3f) << 12) |
            ((bytes[i + 2] & 0x3f) << 6) |
            (bytes[i + 3] & 0x3f);
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

// Mock the window.electron object (guard for Node test environment)
if (typeof window !== 'undefined') {
  Object.defineProperty(window as any, 'electron', {
    value: {
      ipcRenderer: {
        send: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        invoke: jest.fn().mockImplementation((channel: string, _data?: any) => {
          // Workspace operations
          if (channel === '/workspace/list') return Promise.resolve([]);
          if (channel === '/workspace/load') return Promise.resolve(null);
          if (channel === '/workspace/create') return Promise.resolve();
          if (channel === '/workspace/update') return Promise.resolve();
          if (channel === '/workspace/delete') return Promise.resolve();
          if (channel === '/workspace/touch') return Promise.resolve();
          if (channel === '/workspace/rename') return Promise.resolve();

          // Instructions operations
          if (channel === '/instructions/list') return Promise.resolve([]);
          if (channel === '/instructions/create') return Promise.resolve();
          if (channel === '/instructions/update') return Promise.resolve();
          if (channel === '/instructions/delete') return Promise.resolve();

          // File operations
          if (channel === 'request-file-content') {
            return Promise.resolve({
              success: false,
              error: 'Mock: File content not available in test environment',
            });
          }

          // Default response for unknown channels
          // eslint-disable-next-line no-console
          console.warn(`Mock: Unhandled IPC channel: ${channel}`);
          return Promise.resolve(null);
        }),
      },
    },
    writable: true,
    configurable: true,
  });
}

// Mock document.getElementById for React 18 createRoot (guard for Node)
if (typeof document !== 'undefined') {
  (document.getElementById as any) = jest.fn().mockImplementation(() => {
    const div = document.createElement('div');
    (div as any).id = 'root';
    document.body.append(div);
    return div;
  });
}

// Mock window.matchMedia for theme support (guard for Node)
if (typeof window !== 'undefined') {
  Object.defineProperty(window as any, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
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
}

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn(),
} as unknown as Storage;
(global as any).localStorage = localStorageMock;

// Mock for main.tsx (avoid real rendering)
jest.mock('./src/main.tsx', () => ({}), { virtual: true });

// Import and configure worker environment
import { setupWorkerEnvironment, configureWorkerMocks } from './src/__tests__/setup/jest-worker-setup';

// Setup with faster defaults for testing
setupWorkerEnvironment();
configureWorkerMocks({
  autoRespond: true,
  responseDelay: 1, // Reduce from 10ms to 1ms
  initDelay: 1, // Reduce from 5ms to 1ms
  failureRate: 0,
});