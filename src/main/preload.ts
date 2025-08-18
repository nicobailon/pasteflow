import { contextBridge, ipcRenderer } from 'electron';

function ensureSerializable(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(ensureSerializable);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'function' || typeof v === 'symbol') continue;
    result[k] = ensureSerializable(v);
  }
  return result;
}

type IpcFn = (...args: unknown[]) => void;

// Map: channel -> WeakMap(originalFn -> wrapperFn)
const __ipcListenerWrappers = new Map<string, WeakMap<IpcFn, IpcFn>>();

// Centralized, deduplicated listener for 'app-will-quit'
const __appWillQuitSubscribers = new Set<() => void>();
let __appWillQuitRegistered = false;

const __appWillQuitHandler = () => {
  for (const cb of Array.from(__appWillQuitSubscribers)) {
    try {
      cb();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error in app-will-quit subscriber:', err);
    }
  }
};

function addAppWillQuitListener(cb: () => void) {
  if (!__appWillQuitRegistered) {
    ipcRenderer.on('app-will-quit', __appWillQuitHandler);
    __appWillQuitRegistered = true;
  }
  __appWillQuitSubscribers.add(cb);
  return cb;
}

function removeAppWillQuitListener(cb: () => void) {
  __appWillQuitSubscribers.delete(cb);
  if (__appWillQuitRegistered && __appWillQuitSubscribers.size === 0) {
    try {
      ipcRenderer.removeListener('app-will-quit', __appWillQuitHandler);
    } catch {
      // ignore
    }
    __appWillQuitRegistered = false;
  }
}

// Increase max listeners for development mode to handle React StrictMode double mounting
if (process.env.NODE_ENV === 'development') {
  ipcRenderer.setMaxListeners(100);
}

contextBridge.exposeInMainWorld('electron', {
  send: (channel: string, data?: unknown) => {
    // whitelist channels
    const validChannels = [
      'open-folder',
      'request-file-list',
      'apply-changes',
      'cancel-file-loading',
      'app-will-quit-save-complete',
    ];
    if (validChannels.includes(channel)) {
      const serializedData = ensureSerializable(data);
      ipcRenderer.send(channel, serializedData);
    }
  },
  receive: (channel: string, func: IpcFn) => {
    const validChannels = ['folder-selected', 'file-list-data', 'file-processing-status', 'apply-changes-response'];
    if (!validChannels.includes(channel)) return;

    ipcRenderer.on(channel, (_event, ...args: unknown[]) => {
      try {
        const serializedArgs = args.map(ensureSerializable);
        func(...serializedArgs);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Error in IPC receive handler for ${channel}:`, err);
      }
    });
  },
  // For backward compatibility (but still ensure serialization)
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => {
      const serializedArgs = args.map(ensureSerializable);
      ipcRenderer.send(channel, ...serializedArgs);
    },
    on: (channel: string, func: IpcFn) => {
      // Deduplicate app-will-quit: maintain a single underlying ipcRenderer listener
      if (channel === 'app-will-quit') {
        return addAppWillQuitListener(func as () => void);
      }

      const wrapper: IpcFn = (_event: unknown, ...args: unknown[]) => {
        try {
          const serializedArgs = args.map(ensureSerializable);
          func(...serializedArgs);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`IPC handler error for ${channel}:`, err);
        }
      };

      ipcRenderer.on(channel, wrapper);

      let mapForChannel = __ipcListenerWrappers.get(channel);
      if (!mapForChannel) {
        mapForChannel = new WeakMap<IpcFn, IpcFn>();
        __ipcListenerWrappers.set(channel, mapForChannel);
      }
      mapForChannel.set(func, wrapper);
      return wrapper;
    },
    removeListener: (channel: string, func: IpcFn) => {
      if (channel === 'app-will-quit') {
        return removeAppWillQuitListener(func as () => void);
      }
      const mapForChannel = __ipcListenerWrappers.get(channel);
      const maybeWrapper = mapForChannel?.get(func);
      if (maybeWrapper) {
        ipcRenderer.removeListener(channel, maybeWrapper as any);
        mapForChannel?.delete(func);
      } else {
        ipcRenderer.removeListener(channel, func as any);
      }
    },
    invoke: async (channel: string, data?: unknown): Promise<unknown> => {
      const payload = ensureSerializable(data);
      const result = await ipcRenderer.invoke(channel, payload);
      return ensureSerializable(result);
    },
  },
});