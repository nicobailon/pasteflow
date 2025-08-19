export interface HandshakeConfig {
  readySignalType: string;
  initRequestType: string;
  initResponseType: string;
  errorType: string;
  healthCheckType?: string;
  healthResponseType?: string;
}

export function resolveWorkerUrl(workerRelativePath: string): URL | string {
  // Jest environment - return mock path
  if (typeof jest !== 'undefined') {
    return '/mock/worker/path';
  }

  // Try to use import.meta.url for ES modules
  try {
    // Use eval to prevent Jest from parsing this
    const metaUrl = eval('import.meta.url');
    return new URL(workerRelativePath, metaUrl);
  } catch {
    // Fall back to development or production paths
    if (typeof window !== 'undefined') {
      const hostname = window.location?.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // Development path
        const basename = workerRelativePath.split('/').pop() ?? '';
        return `/src/workers/${basename}`;
      }
    }
    
    // Electron production path
    const basename = workerRelativePath.split('/').pop() ?? '';
    return `./assets/${basename.replace('.ts', '.js')}`;
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