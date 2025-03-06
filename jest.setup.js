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