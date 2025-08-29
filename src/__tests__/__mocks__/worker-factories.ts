/**
 * Mock worker factories for Jest testing.
 * Returns mock workers that simulate real worker behavior without import.meta.url.
 */

// Simple mock - just returns Worker constructor 
// The global Worker is mocked in worker-mock-setup.js
export function createTokenCounterWorker(): Worker {
  // @ts-expect-error Worker is mocked globally
  return new Worker('/mock/token-counter-worker', { type: 'module' });
}

export function createTreeBuilderWorker(): Worker {
  // @ts-expect-error Worker is mocked globally
  return new Worker('/mock/tree-builder-worker', { type: 'module' });
}