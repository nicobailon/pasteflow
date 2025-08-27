/**
 * Enhanced Jest setup for Worker mocking
 * Provides complete Worker API mocking with type safety
 */

import { MockWorker } from '../test-utils/mock-worker';

// Type-safe Worker mock interface
interface WorkerMockConfig {
  autoRespond: boolean;
  responseDelay: number;
  initDelay: number;
  failureRate: number;
}

const defaultConfig: WorkerMockConfig = {
  autoRespond: true,
  responseDelay: 10,
  initDelay: 5,
  failureRate: 0
} as const;

// Global state for worker mocking
let globalWorkerConfig = { ...defaultConfig };
let originalWorker: typeof Worker | undefined;
let originalURL: typeof URL | undefined;

/**
 * Configure global worker behavior
 */
export function configureWorkerMocks(config: Partial<WorkerMockConfig>): void {
  globalWorkerConfig = { ...globalWorkerConfig, ...config };
}

/**
 * Setup comprehensive Worker mocking for Jest
 * This should be called in jest.setup.js or at the top of test files
 */
export function setupWorkerEnvironment(): void {
  // Store originals
  originalWorker = global.Worker;
  originalURL = global.URL;

  // Mock import.meta for modules
  if (!('importMeta' in global)) {
    Object.defineProperty(global, 'importMeta', {
      writable: true,
      configurable: true,
      value: { url: 'http://localhost/test' }
    });
  }

  // Mock URL constructor with proper behavior
  const MockURL = jest.fn().mockImplementation((url: string, base?: string) => {
    // Handle relative URLs
    if (base && url.startsWith('../')) {
      const basePath = base.replace(/\/[^/]*$/, '');
      const resolvedUrl = `${basePath}/${url.replace('../', '')}`;
      return {
        href: resolvedUrl,
        pathname: resolvedUrl,
        toString: () => resolvedUrl,
        searchParams: new URLSearchParams(),
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        port: '',
        search: '',
        hash: '',
        origin: 'http://localhost'
      };
    }
    
    return {
      href: url,
      pathname: url,
      toString: () => url,
      searchParams: new URLSearchParams(),
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      search: '',
      hash: '',
      origin: 'http://localhost'
    };
  });

  Object.defineProperty(global, 'URL', {
    writable: true,
    configurable: true,
    value: MockURL
  });

  // Mock Worker constructor
  const MockWorkerConstructor = jest.fn().mockImplementation(function(
    _scriptURL: string | URL,
    _options?: WorkerOptions
  ) {
    const worker = new MockWorker({
      autoRespond: globalWorkerConfig.autoRespond,
      responseDelay: globalWorkerConfig.responseDelay
    });

    // Send WORKER_READY signal immediately as real workers do
    setTimeout(() => {
      worker.simulateMessage({
        type: 'WORKER_READY'
      });
    }, 0);
    
    // Simulate initialization based on config
    if (globalWorkerConfig.autoRespond) {
      setTimeout(() => {
        if (Math.random() > globalWorkerConfig.failureRate) {
          worker.simulateMessage({
            type: 'INIT_COMPLETE',
            id: `init-${Date.now()}`,
            success: true
          });
        } else {
          worker.simulateError(new Error('Worker initialization failed'));
        }
      }, globalWorkerConfig.initDelay);
    }

    return worker;
  });

  // Ensure spies like jest.spyOn(global.Worker.prototype, 'postMessage') work
  // by pointing the constructor prototype at our MockWorker prototype.
  // This allows tests to observe postMessage calls made by instances.
  MockWorkerConstructor.prototype = (MockWorker as unknown as { prototype: any }).prototype;

  Object.defineProperty(global, 'Worker', {
    writable: true,
    configurable: true,
    value: MockWorkerConstructor
  });

  // Mock navigator.hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    writable: true,
    configurable: true,
    value: 4
  });
}

/**
 * Restore original Worker and URL constructors
 */
export function restoreWorkerEnvironment(): void {
  if (originalWorker) {
    Object.defineProperty(global, 'Worker', {
      writable: true,
      configurable: true,
      value: originalWorker
    });
  }

  if (originalURL) {
    Object.defineProperty(global, 'URL', {
      writable: true,
      configurable: true,
      value: originalURL
    });
  }

  // Reset config
  globalWorkerConfig = { ...defaultConfig };
}