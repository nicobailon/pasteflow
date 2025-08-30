/**
 * Worker factory functions for creating Web Workers with Vite-compatible static imports.
 * This file is mocked in Jest to avoid import.meta.url syntax errors during testing.
 */

export function createTokenCounterWorker(): Worker {
  return new Worker(
    new URL('../workers/token-counter-worker.ts', import.meta.url),
    { type: 'module' }
  );
}

export function createTreeBuilderWorker(): Worker {
  return new Worker(
    new URL('../workers/tree-builder-worker.ts', import.meta.url),
    { type: 'module' }
  );
}