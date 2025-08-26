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
if (typeof global !== 'undefined' && !(global as unknown as { import?: unknown }).import) {
  (global as unknown as { import: { meta: { url: string } } }).import = {
    meta: {
      url: 'file:///mock/path/to/file.js',
    },
  };
}

// Mock Worker for worker pool tests
if ((global as unknown as { Worker?: typeof Worker }).Worker === undefined) {
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
    listeners: Map<string, ((event: Event | MessageEvent) => void)[]>;

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

    addEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type)!.push(listener);
    }

    removeEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
      const listeners = this.listeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }

    dispatchEvent(event: Event | MessageEvent) {
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) listener(event);
      }
    }

    terminate() {
      this.listeners.clear();
    }
  }

  (global as unknown as { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;
}

// Polyfill TextEncoder/TextDecoder for Jest environment
if ((global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder === undefined) {
  (global as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = class {
    encode(input: string) {
      const bytes: number[] = [];
      for (let i = 0; i < input.length; i++) {
        const char = input.codePointAt(i) ?? 0;
        if (char < 0x80) {
          bytes.push(char);
        } else if (char < 0x8_00) {
          bytes.push(0xC0 | (char >> 6), 0x80 | (char & 0x3F));
        } else if (char < 0xD8_00 || char >= 0xE0_00) {
          bytes.push(0xE0 | (char >> 12), 0x80 | ((char >> 6) & 0x3F), 0x80 | (char & 0x3F));
        } else {
          // Handle surrogate pairs
          i++;
          const char2 = input.codePointAt(i) ?? 0;
          const codePoint = 0x1_00_00 + (((char & 0x3_FF) << 10) | (char2 & 0x3_FF));
          bytes.push(
            0xF0 | (codePoint >> 18),
            0x80 | ((codePoint >> 12) & 0x3F),
            0x80 | ((codePoint >> 6) & 0x3F),
            0x80 | (codePoint & 0x3F),
          );
        }
      }
      return new Uint8Array(bytes);
    }
  };
}

if ((global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder === undefined) {
  (global as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = class {
    decode(bytes: Uint8Array) {
      let result = '';
      let i = 0;
      while (i < bytes.length) {
        const byte = bytes[i];
        if (byte < 0x80) {
          result += String.fromCodePoint(byte);
          i++;
        } else if ((byte & 0xE0) === 0xC0) {
          result += String.fromCodePoint(((byte & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
          i += 2;
        } else if ((byte & 0xF0) === 0xE0) {
          result += String.fromCodePoint(((byte & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
          i += 3;
        } else {
          const codePoint =
            ((byte & 0x07) << 18) |
            ((bytes[i + 1] & 0x3F) << 12) |
            ((bytes[i + 2] & 0x3F) << 6) |
            (bytes[i + 3] & 0x3F);
          const high = Math.floor((codePoint - 0x1_00_00) / 0x4_00) + 0xD8_00;
          const low = ((codePoint - 0x1_00_00) % 0x4_00) + 0xDC_00;
          result += String.fromCodePoint(high, low);
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