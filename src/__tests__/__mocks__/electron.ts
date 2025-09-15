import { EventEmitter } from 'node:events';

type IpcListener = (event: unknown, payload: unknown) => void;

const ipcListeners = new Map<string, IpcListener[]>();

export const ipcMain = {
  on(channel: string, listener: IpcListener) {
    const listeners = ipcListeners.get(channel) ?? [];
    listeners.push(listener);
    ipcListeners.set(channel, listeners);
  },
  removeAllListeners(channel?: string) {
    if (channel) {
      ipcListeners.delete(channel);
    } else {
      ipcListeners.clear();
    }
  },
  emit(channel: string, payload?: unknown) {
    const listeners = ipcListeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      listener({}, payload);
    }
  },
};

const browserWindows: { webContents: { send: (channel: string, payload?: unknown) => void } }[] = [];

export const BrowserWindow = {
  getAllWindows() {
    return browserWindows;
  },
};

export const dialog = {
  showOpenDialog: jest.fn(),
  showMessageBox: jest.fn(),
};

export const app = new EventEmitter() as unknown as {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  getPath: (name: string) => string;
};

(app as unknown as { getPath: (name: string) => string }).getPath = () => process.cwd();

export const shell = {
  openPath: jest.fn(),
};

export const ipcRenderer = new EventEmitter();

export type IpcMainEvent = unknown;
export type BrowserWindow = typeof BrowserWindow;
