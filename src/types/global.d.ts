// Global window API types for Electron preload bridges and runtime-provided info.
export {};

declare global {
  interface PasteflowApiInfo {
    apiBase?: string;
    authToken?: string;
  }

  interface ElectronIpcRenderer {
    invoke?: (channel: string, payload?: unknown) => Promise<unknown>;
    send?: (channel: string, payload?: unknown) => void;
    on?: (channel: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void;
  }

  interface Window {
    electron?: { ipcRenderer?: ElectronIpcRenderer };
    __PF_API_INFO?: PasteflowApiInfo;
  }
}

