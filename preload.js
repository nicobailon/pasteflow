// Preload script
const { contextBridge, ipcRenderer } = require("electron");

// Increase max listeners for development mode to handle React StrictMode double mounting
// In development, React StrictMode intentionally double-mounts components to detect side effects
// This causes temporary listener accumulation during the mount/unmount/remount cycle
if (process.env.NODE_ENV === 'development') {
  // Set a higher limit to accommodate StrictMode behavior
  // We have ~13 usePersistentState hooks, so 30 should be safe for double mounting
  ipcRenderer.setMaxListeners(100);
}

// Helper function to ensure data is serializable
function ensureSerializable(data) {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitive types directly
  if (typeof data !== "object") {
    return data;
  }

  // For arrays, map each item
  if (Array.isArray(data)) {
    return data.map(ensureSerializable);
  }

  // For objects, create a new object with serializable properties
  const result = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      // Skip functions or symbols which are not serializable
      if (typeof data[key] === "function" || typeof data[key] === "symbol") {
        continue;
      }
      // Recursively process nested objects
      result[key] = ensureSerializable(data[key]);
    }
  }
  return result;
}

// Map channel -> WeakMap<originalFn, wrapperFn>
// Using WeakMap so original function references don't prevent GC when user code drops them
const __ipcListenerWrappers = new Map();
// Centralized, deduplicated listener for 'app-will-quit' to prevent leaks across re-renders
const __appWillQuitSubscribers = new Set();
let __appWillQuitRegistered = false;
const __appWillQuitHandler = () => {
  for (const cb of Array.from(__appWillQuitSubscribers)) {
    try {
      typeof cb === 'function' && cb();
    } catch (err) {
      console.error('Error in app-will-quit subscriber:', err);
    }
  }
};
function addAppWillQuitListener(cb) {
  if (!__appWillQuitRegistered) {
    ipcRenderer.on('app-will-quit', __appWillQuitHandler);
    __appWillQuitRegistered = true;
  }
  __appWillQuitSubscribers.add(cb);
  return cb;
}
function removeAppWillQuitListener(cb) {
  __appWillQuitSubscribers.delete(cb);
  if (__appWillQuitRegistered && __appWillQuitSubscribers.size === 0) {
    try {
      ipcRenderer.removeListener('app-will-quit', __appWillQuitHandler);
    } catch {}
    __appWillQuitRegistered = false;
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electron", {
  send: (channel, data) => {
    // whitelist channels
    const validChannels = ["open-folder", "request-file-list", "apply-changes", "cancel-file-loading", "app-will-quit-save-complete"];
    if (validChannels.includes(channel)) {
      // Ensure data is serializable before sending
      const serializedData = ensureSerializable(data);
      ipcRenderer.send(channel, serializedData);
    }
  },
  receive: (channel, func) => {
    const validChannels = [
      "folder-selected",
      "file-list-data",
      "file-processing-status",
      "apply-changes-response",
    ];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (event, ...args) => {
        // Convert args to serializable form
        const serializedArgs = args.map(ensureSerializable);
        func(...serializedArgs);
      });
    }
  },
  // For backward compatibility (but still ensure serialization)
  ipcRenderer: {
    send: (channel, ...args) => {
      const serializedArgs = args.map(ensureSerializable);
      ipcRenderer.send(channel, ...serializedArgs);
    },
    on: (channel, func) => {
      // Deduplicate app-will-quit: maintain a single underlying ipcRenderer listener
      if (channel === 'app-will-quit') {
        return addAppWillQuitListener(func);
      }

      const wrapper = (event, ...args) => {
        try {
          // Don't pass the event object to the callback, only pass the serialized args
          const serializedArgs = args.map(ensureSerializable);
          func(...serializedArgs); // Only pass the serialized args, not the event
        } catch (error) {
          console.error(`Error in IPC handler for channel ${channel}:`, error);
        }
      };
      ipcRenderer.on(channel, wrapper);

      // Store the wrapper so removeListener can work when called with the original function
      let mapForChannel = __ipcListenerWrappers.get(channel);
      if (!mapForChannel) {
        mapForChannel = new WeakMap();
        __ipcListenerWrappers.set(channel, mapForChannel);
      }
      mapForChannel.set(func, wrapper);

      // Return the wrapper for callers that keep and remove it directly
      return wrapper;
    },
    removeListener: (channel, func) => {
      try {
        // Special handling for app-will-quit deduped subscription
        if (channel === 'app-will-quit') {
          removeAppWillQuitListener(func);
          return;
        }

        const mapForChannel = __ipcListenerWrappers.get(channel);
        const maybeWrapper = mapForChannel ? mapForChannel.get(func) : undefined;

        if (maybeWrapper) {
          ipcRenderer.removeListener(channel, maybeWrapper);
          // Clean mapping
          mapForChannel.delete(func);
        } else {
          // Fall back to removing the provided function (in case caller stored the wrapper)
          ipcRenderer.removeListener(channel, func);
        }
      } catch (error) {
        console.error(`Error removing listener for channel ${channel}:`, error);
      }
    },
    // Add invoke method for promise-based IPC
    invoke: async (channel, data) => {
      try {
        const serializedData = ensureSerializable(data);
        const result = await ipcRenderer.invoke(channel, serializedData);
        return ensureSerializable(result);
      } catch (error) {
        console.error(`Error invoking IPC channel ${channel}:`, error);
        throw error;
      }
    }
  },
});
