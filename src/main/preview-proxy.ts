import { EventEmitter } from 'node:events';

import { BrowserWindow, ipcMain } from 'electron';

export type PreviewStartOptions = {
  includeTrees?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  prompt?: string;
};

type StatusPayload = {
  id: string;
  state?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  message?: string;
  progress?: number;
};

type ContentPayload = {
  id: string;
  content: string;
  fileCount?: number;
};

export class RendererPreviewProxy extends EventEmitter {
  constructor() {
    super();

    // Listen for renderer-emitted status updates
    ipcMain.on('cli-pack-status', (_e, payload: StatusPayload) => {
      if (payload && payload.id) {
        this.emit('status', payload.id, payload);
      }
    });

    // Listen for renderer-emitted content payloads
    ipcMain.on('cli-pack-content', (_e, payload: ContentPayload) => {
      if (payload && payload.id) {
        this.emit('content', payload.id, payload);
      }
    });
  }

  // Kick off a preview job in the renderer with correlation id
  start(id: string, options: PreviewStartOptions): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('cli-pack-start', { id, options });
      } catch {
        /* ignore */
      }
    }
  }

  // Best-effort cancel request for a given id
  cancel(id: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('cli-pack-cancel', { id });
      } catch {
        /* ignore */
      }
    }
  }

  // Helpers for consumers to subscribe filtered by id
  onStatus(id: string, handler: (payload: StatusPayload) => void): () => void {
    const listener = (payloadId: string, payload: StatusPayload) => {
      if (payloadId === id) handler(payload);
    };
    this.on('status', listener as any);
    return () => this.off('status', listener as any);
  }

  onContent(id: string, handler: (payload: ContentPayload) => void): () => void {
    const listener = (payloadId: string, payload: ContentPayload) => {
      if (payloadId === id) handler(payload);
    };
    this.on('content', listener as any);
    return () => this.off('content', listener as any);
  }
}