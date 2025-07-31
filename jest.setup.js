// Import jest-dom matchers
require('@testing-library/jest-dom');

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
      removeListener: jest.fn()
    }
  },
  writable: true
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