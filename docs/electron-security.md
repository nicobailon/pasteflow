# Electron IPC Security Best Practices

## Overview

This document outlines security best practices for IPC (Inter-Process Communication) between the renderer and main processes in our Electron application.

## Current Implementation

Our application uses a preload script to expose a limited API to the renderer process. This follows the Electron security model of contextual isolation and limited exposure.

## Security Best Practices

### 1. Context Isolation

Always use Context Isolation to prevent direct access to Electron or Node.js APIs from the renderer:

```javascript
// In main.js when creating a window
webPreferences: {
  contextIsolation: true,
  preload: path.join(__dirname, 'preload.js')
}
```

### 2. Expose Minimal API Surface

Only expose necessary functions through the preload script:

```javascript
// In preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    // Whitelist channels to validate
    const validChannels = ['file-operation', 'get-files', 'save-file'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ['file-operation-result', 'file-list', 'save-result'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});
```

### 3. Validate All Inputs

Always validate inputs from the renderer process before performing operations:

```javascript
// In main.js
ipcMain.on('file-operation', (event, arg) => {
  // Validate arg before using it
  if (!arg || typeof arg.path !== 'string' || !arg.path.startsWith('/safe/path/')) {
    event.reply('file-operation-result', { error: 'Invalid path' });
    return;
  }
  
  // Proceed with operation...
});
```

### 4. Use IPC for Communication, Not Remote

Avoid using remote module and prefer IPC for communication between processes.

### 5. Limit File System Access

Restrict file system access to specific directories:

```javascript
// In main.js
ipcMain.on('save-file', (event, { path, content }) => {
  // Ensure path is within allowed directories
  const normalizedPath = path.normalize(path);
  if (!normalizedPath.startsWith(app.getPath('userData'))) {
    event.reply('save-result', { error: 'Path not allowed' });
    return;
  }
  
  // Proceed with file saving...
});
```

### 6. Serialize Data Properly

Ensure all data passed through IPC is properly serialized and doesn't contain functions or other non-serializable content:

```javascript
// In preload.js
function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    console.error('Error serializing object:', e);
    return null;
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return null;
  }
}
```

### 7. Prevent Webview/BrowserView Abuse

If using webviews or BrowserViews, ensure they are properly secured:

```javascript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true
}
```

## Implementation Checklist

- [ ] Context isolation is enabled
- [ ] Preload script only exposes necessary APIs
- [ ] All IPC channels are validated
- [ ] All input from renderer is validated
- [ ] File system access is limited to safe paths
- [ ] Data serialization is handled safely
- [ ] Regular security audits of IPC communication 