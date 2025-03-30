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

// Mock for main.tsx
jest.mock('./src/main.tsx', () => ({}), { virtual: true }); 