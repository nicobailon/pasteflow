import type { SelectedFileReference, WorkspaceUpdatedPayload } from "../shared-types";
import { BROADCAST_CONFIG } from "../constants/broadcast";
import { createRequire } from "node:module";

// Local require that works in both CJS (module.require) and ESM (createRequire)
const nodeRequire: NodeJS.Require = (typeof module !== "undefined" && (module as any).require)
  ? (module as any).require.bind(module)
  : createRequire(import.meta.url);

/**
 * Centralized broadcasting utilities for sending IPC messages to all
 * renderer windows. This module avoids hard dependencies on Electron in
 * test/headless environments via lazy, cached requires and provides
 * debouncing and lightweight rate limiting to prevent UI floods.
 */

type BrowserWindowType = {
  getAllWindows: () => Array<{ webContents: { send: (ch: string, payload?: unknown) => void } }>;
};

let cachedBrowserWindow: BrowserWindowType | null | undefined;

function getBrowserWindow(): BrowserWindowType | null {
  if (cachedBrowserWindow !== undefined) return cachedBrowserWindow;
  try {
    const { BrowserWindow } = nodeRequire("electron") as { BrowserWindow: BrowserWindowType };
    cachedBrowserWindow = BrowserWindow;
  } catch {
    cachedBrowserWindow = null;
  }
  return cachedBrowserWindow;
}

/**
 * Simple per-channel rate limiter. Allows up to N sends per second.
 */
const MAX_EVENTS_PER_SECOND = BROADCAST_CONFIG.MAX_EVENTS_PER_SECOND;
const rateState = new Map<string, { count: number; windowStart: number }>();

function allowSend(channel: string): boolean {
  const now = Date.now();
  const state = rateState.get(channel);
  if (!state) {
    rateState.set(channel, { count: 1, windowStart: now });
    return true;
  }
  if (now - state.windowStart >= 1000) {
    state.windowStart = now;
    state.count = 1;
    return true;
  }
  if (state.count < MAX_EVENTS_PER_SECOND) {
    state.count += 1;
    return true;
  }
  return false; // rate limited
}

/**
 * Broadcast immediately to all renderer windows (best-effort). Swallows
 * per-window failures and does nothing if Electron is unavailable.
 */
export function broadcastToRenderers(channel: string, payload?: unknown): void {
  if (!allowSend(channel)) return;
  const BW = getBrowserWindow();
  if (!BW) return;
  const windows = BW.getAllWindows();
  for (const win of windows) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      // ignore individual window failures
    }
  }
}

/**
 * Debounced broadcast per-channel. Subsequent calls within waitMs replace the
 * payload. Useful to coalesce rapid-fire updates.
 */
const debounceTimers = new Map<string, NodeJS.Timeout>();
const debounceLastPayload = new Map<string, unknown>();

export function debouncedBroadcastToRenderers(channel: string, payload?: unknown, waitMs = BROADCAST_CONFIG.DEBOUNCE_MS): void {
  debounceLastPayload.set(channel, payload);
  const existing = debounceTimers.get(channel);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(channel);
    const last = debounceLastPayload.get(channel);
    broadcastToRenderers(channel, last);
  }, waitMs);
  debounceTimers.set(channel, timer);
}

/**
 * Shared payload for workspace selection updates.
 */
/**
 * Per-workspace sequence numbers to prevent out-of-order updates.
 */
const workspaceSeq = new Map<string, number>();

/**
 * Broadcast a workspace-updated event with sequencing and timestamp.
 * Coalesces rapid updates with a small debounce to reduce event storms.
 */
export function broadcastWorkspaceUpdated(input: {
  workspaceId: string;
  folderPath: string;
  selectedFiles: SelectedFileReference[];
}): void {
  const prev = workspaceSeq.get(input.workspaceId) ?? 0;
  const nextSeq = prev + 1;
  workspaceSeq.set(input.workspaceId, nextSeq);

  const payload: WorkspaceUpdatedPayload = {
    workspaceId: input.workspaceId,
    folderPath: input.folderPath,
    selectedFiles: input.selectedFiles,
    sequence: nextSeq,
    timestamp: Date.now(),
  };

  debouncedBroadcastToRenderers("workspace-updated", payload, BROADCAST_CONFIG.DEBOUNCE_MS);
}
