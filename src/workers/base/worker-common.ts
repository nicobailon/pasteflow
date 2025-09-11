declare const jest: { fn?: unknown } | undefined;

export interface HandshakeConfig {
  readySignalType: string;
  initRequestType: string;
  initResponseType: string;
  errorType: string;
  healthCheckType?: string;
  healthResponseType?: string;
}

/**
 * Resolves the worker URL based on the current environment.
 * - Jest: Returns mock path for testing
 * - Development: Returns Vite dev server path (/src/workers/*)
 * - Electron Production: Returns bundled asset path (./assets/*.js)
 * 
 * @param workerRelativePath - Relative path to the worker file
 * @returns Resolved URL for Worker constructor
 */
export function resolveWorkerUrl(workerRelativePath: string): string {
  // Try import.meta.url first for module resolution
  try {
    const metaUrl = eval('import.meta.url');
    const url = new URL(workerRelativePath, metaUrl).toString();
    debugLog(`Resolved worker URL via import.meta: ${url}`);
    return url;
  } catch {
    // Fallback to environment-specific resolution
    
    // Jest environment - return mock path
    if (jest !== undefined) {
      const mockPath = '/mock/worker/path';
      debugLog(`Jest environment detected, using mock: ${mockPath}`);
      return mockPath;
    }

    // Extract basename for use in paths
    const basename = workerRelativePath.split('/').pop() ?? '';

    // In Electron renderer, check if we're in development
    if (typeof window !== 'undefined') {
      const hostname = window.location?.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // Development path - Vite serves from /src
        const devPath = `/src/workers/${basename}`;
        debugLog(`Development environment detected, using: ${devPath}`);
        return devPath;
      }
    }
    
    // Electron production path - workers are bundled to assets
    const prodPath = `./assets/${basename.replace('.ts', '.js')}`;
    debugLog(`Production environment, using bundled: ${prodPath}`);
    return prodPath;
  }
}

export function addWorkerListeners(
  worker: Worker,
  handlers: {
    message: (e: MessageEvent) => void;
    error?: (e: ErrorEvent) => void;
    messageerror?: (e: MessageEvent) => void;
  }
): void {
  worker.addEventListener('message', handlers.message);
  if (handlers.error) {
    worker.addEventListener('error', handlers.error);
  }
  if (handlers.messageerror) {
    worker.addEventListener('messageerror', handlers.messageerror);
  }
}

export function removeWorkerListeners(
  worker: Worker,
  handlers: {
    message: (e: MessageEvent) => void;
    error?: (e: ErrorEvent) => void;
    messageerror?: (e: MessageEvent) => void;
  }
): void {
  try {
    worker.removeEventListener('message', handlers.message);
    if (handlers.error) {
      worker.removeEventListener('error', handlers.error);
    }
    if (handlers.messageerror) {
      worker.removeEventListener('messageerror', handlers.messageerror);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function debugLog(message: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[WorkerBase] ${message}`, ...args);
  }
}

