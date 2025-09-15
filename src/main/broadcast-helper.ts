/* eslint-disable unicorn/prefer-module */
import { createRequire } from "node:module";

import type { SelectedFileReference, WorkspaceUpdatedPayload } from "../shared-types";
import { BROADCAST_CONFIG } from "../constants/broadcast";

const resolveModuleSpecifier = (): string | undefined => {
  try {
    return (new Function("return import.meta.url") as () => string)();
  } catch {
    return undefined;
  }
};

const moduleSpecifier = resolveModuleSpecifier();
const fallbackSpecifier = moduleSpecifier ?? process.cwd();

const nodeRequire: NodeJS.Require = typeof require === "function"
  ? require
  : createRequire(fallbackSpecifier);

/**
 * Centralized broadcasting utilities for sending IPC messages to all
 * renderer windows. This module avoids hard dependencies on Electron in
 * test/headless environments via lazy, cached requires and provides
 * debouncing and lightweight rate limiting to prevent UI floods.
 */

type BrowserWindowType = {
  getAllWindows: () => { webContents: { send: (ch: string, payload?: unknown) => void } }[];
};

let cachedBrowserWindow: BrowserWindowType | null | undefined;
let activeConfig = BROADCAST_CONFIG;

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
  if (state.count < activeConfig.MAX_EVENTS_PER_SECOND) {
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

export function debouncedBroadcastToRenderers(channel: string, payload?: unknown, waitMs = activeConfig.DEBOUNCE_MS): void {
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

  debouncedBroadcastToRenderers("workspace-updated", payload, activeConfig.DEBOUNCE_MS);
}

export function __setBrowserWindowForTests(window: BrowserWindowType | null): void {
  cachedBrowserWindow = window;
}

export function __resetBroadcastStateForTests(): void {
  cachedBrowserWindow = undefined;
  rateState.clear();
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  debounceLastPayload.clear();
  activeConfig = BROADCAST_CONFIG;
}

export function __setBroadcastConfigForTests(config: typeof BROADCAST_CONFIG): void {
  activeConfig = config;
}

export type BroadcastHelperTestExports = {
  broadcastToRenderers: typeof broadcastToRenderers;
  debouncedBroadcastToRenderers: typeof debouncedBroadcastToRenderers;
  broadcastWorkspaceUpdated: typeof broadcastWorkspaceUpdated;
  __setBrowserWindowForTests: typeof __setBrowserWindowForTests;
  __resetBroadcastStateForTests: typeof __resetBroadcastStateForTests;
  __setBroadcastConfigForTests: typeof __setBroadcastConfigForTests;
};
