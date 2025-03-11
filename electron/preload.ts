// Define explicitly allowed channels
const validSendChannels = [
  'file-operation', 
  'get-files', 
  'save-file',
  'parse-xml',
  'apply-changes'
  // Add all other valid channels used in your app
];

const validReceiveChannels = [
  'file-operation-result', 
  'file-list', 
  'save-result',
  'parse-xml-result',
  'apply-changes-result'
  // Add all other valid channels used in your app
];

// Sanitize data before sending through IPC
function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  
  try {
    // Serialize and deserialize to remove any functions or non-JSON content
    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    console.error('Failed to sanitize IPC data:', e);
    return null;
  }
}

// Replace the existing API exposure with this more secure version
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data: unknown) => {
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, sanitizeData(data));
    } else {
      console.error(`Attempted to send on unauthorized channel: ${channel}`);
    }
  },
  
  invoke: async (channel: string, data: unknown) => {
    if (validSendChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, sanitizeData(data));
    } else {
      console.error(`Attempted to invoke on unauthorized channel: ${channel}`);
      throw new Error(`Unauthorized channel: ${channel}`);
    }
  },
  
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    if (validReceiveChannels.includes(channel)) {
      // Wrap the callback to sanitize incoming data
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => 
        func(...args.map(arg => sanitizeData(arg)));
      
      ipcRenderer.on(channel, subscription);
      
      // Return a function to remove the listener
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.error(`Attempted to listen on unauthorized channel: ${channel}`);
      return () => {}; // Return no-op function
    }
  }
}); 