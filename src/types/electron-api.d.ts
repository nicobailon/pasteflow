export {};

declare global {
  interface Window {
    electron: {
      send: (channel: string, data?: unknown) => void;
      receive: (channel: string, fn: (...args: unknown[]) => void) => void;
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void;
        on: (channel: string, fn: (...args: unknown[]) => void) => void;
        removeListener: (channel: string, fn: (...args: unknown[]) => void) => void;
        invoke: (channel: string, data?: unknown) => Promise<unknown>;
      };
    };
  }
}