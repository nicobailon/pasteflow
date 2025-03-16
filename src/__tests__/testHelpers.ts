// Shared test helpers and mocks

// Mock localStorage functionality
export const setupMockLocalStorage = () => {
  const mockLocalStorage = (function() {
    let store: Record<string, string> = {};
    
    return {
      getItem: (key: string) => {
        return store[key] || null;
      },
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
  })();

  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage
  });

  // Initialize with empty values
  window.localStorage.clear();
};

// Safely mock Date.now() with automatic cleanup
export const mockDateNow = (mockValue: number) => {
  const originalDateNow = Date.now;
  jest.spyOn(Date, 'now').mockImplementation(() => mockValue);
  
  // Return cleanup function
  return () => {
    (Date.now as jest.Mock).mockRestore();
  };
}; 