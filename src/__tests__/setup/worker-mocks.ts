/**
 * Global Worker mocks for Jest tests
 * Handles the import.meta.url issue and provides a working Worker mock
 */

import { MockWorker, MockWorkerOptions } from '../test-utils/mock-worker';

// Store for active mock workers
export const mockWorkerInstances: MockWorker[] = [];

// Factory for creating mock workers
export let mockWorkerFactory: (options?: MockWorkerOptions) => MockWorker = 
  (options) => new MockWorker(options || { autoRespond: true, responseDelay: 10 });

/**
 * Sets up global Worker mock
 * Call this in beforeEach to ensure clean state
 */
export function setupWorkerMocks(options?: {
  workerFactory?: (options?: MockWorkerOptions) => MockWorker;
}) {
  // Clear previous instances
  mockWorkerInstances.length = 0;
  
  if (options?.workerFactory) {
    mockWorkerFactory = options.workerFactory;
  }

  // Mock the global Worker constructor
  Object.defineProperty(global, 'Worker', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((_url: string | URL, _options?: WorkerOptions) => {
      // Create a mock worker instance
      const worker = mockWorkerFactory();
      mockWorkerInstances.push(worker);
      
      // Simulate initialization
      setTimeout(() => {
        worker.simulateMessage({ 
          type: 'INIT_COMPLETE', 
          id: `init-${mockWorkerInstances.length - 1}`, 
          success: true 
        });
      }, 5);
      
      return worker;
    })
  });

  // Mock URL constructor to handle import.meta.url
  Object.defineProperty(global, 'URL', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((url: string, _base?: string) => {
      return { 
        href: url, 
        toString: () => url,
        pathname: url
      };
    })
  });
}

/**
 * Cleans up Worker mocks
 * Call this in afterEach
 */
export function cleanupWorkerMocks() {
  // Terminate all mock workers
  mockWorkerInstances.forEach(worker => worker.terminate());
  mockWorkerInstances.length = 0;
  
  // Reset Worker constructor
  if ('Worker' in global) {
    delete (global as any).Worker;
  }
}