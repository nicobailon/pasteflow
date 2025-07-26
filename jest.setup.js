// Import jest-dom matchers
require('@testing-library/jest-dom');

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