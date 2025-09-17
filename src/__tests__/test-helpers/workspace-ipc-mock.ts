import { WorkspaceState } from "../../types/file-types";

export interface WorkspaceRecord {
  id: string;
  name: string;
  folderPath: string;
  state: WorkspaceState;
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
}

export type WorkspaceOverrides = Partial<Omit<WorkspaceRecord, "name" | "state">>;

export interface WorkspaceIpcMock {
  ipcRenderer: ElectronIpcRendererMock;
  setWorkspace: (name: string, state: WorkspaceState, overrides?: WorkspaceOverrides) => WorkspaceRecord;
  getWorkspace: (name: string) => WorkspaceRecord | undefined;
  listWorkspaces: () => WorkspaceRecord[];
  emit: (channel: string, ...args: unknown[]) => void;
  restore: () => void;
  preferences: Map<string, unknown>;
}

function cloneValue<T>(value: T): T {
  const structured = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone;
  if (typeof structured === "function") {
    return structured(value);
  }

  if (value === undefined) {
    return value;
  }

  const json = JSON.stringify(value);
  if (!json) {
    return value;
  }

  return JSON.parse(json) as T;
}

function normalizeWorkspaceState(state: WorkspaceState): WorkspaceState {
  const cloned = cloneValue(state);
  if (!cloned.selectedInstructions) {
    cloned.selectedInstructions = [];
  }
  return cloned;
}

export function buildWorkspaceStateFixture(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  const base: WorkspaceState = {
    selectedFolder: null,
    selectedFiles: [],
    expandedNodes: {},
    sortOrder: "tokens-desc",
    searchTerm: "",
    fileTreeMode: "none",
    exclusionPatterns: [],
    userInstructions: "",
    tokenCounts: {},
    systemPrompts: [],
    rolePrompts: [],
    selectedInstructions: [],
  };
  return { ...base, ...overrides };
}

export function setupWorkspaceIpcMock(): WorkspaceIpcMock {
  const previousElectron = window.electron;
  const previousIpc = previousElectron?.ipcRenderer;

  const workspacesByName = new Map<string, WorkspaceRecord>();
  const workspacesById = new Map<string, WorkspaceRecord>();
  const preferences = new Map<string, unknown>();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  let idCounter = 1;

  const toRecord = (name: string, state: WorkspaceState, overrides?: WorkspaceOverrides): WorkspaceRecord => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const record: WorkspaceRecord = {
      id: overrides?.id ?? `ws-${idCounter++}`,
      name,
      folderPath: overrides?.folderPath ?? state.selectedFolder ?? "",
      state: normalizeWorkspaceState(state),
      createdAt: overrides?.createdAt ?? nowSeconds,
      updatedAt: overrides?.updatedAt ?? nowSeconds,
      lastAccessed: overrides?.lastAccessed ?? nowSeconds,
    };
    return record;
  };

  const storeRecord = (record: WorkspaceRecord) => {
    workspacesByName.set(record.name, record);
    workspacesById.set(record.id, record);
    return record;
  };

  const findWorkspace = (idOrName: string): WorkspaceRecord | undefined => {
    return workspacesByName.get(idOrName) ?? workspacesById.get(idOrName);
  };

  const wrapSuccess = <T>(data: T) => ({ success: true, data });
  const wrapError = (error: string) => ({ success: false, error });

  const invoke = jest.fn(async (channel: string, ...args: unknown[]) => {
    const payload = args[0];

    switch (channel) {
      case "/workspace/list": {
        const records = Array.from(workspacesByName.values()).map((workspace) => ({
          ...workspace,
          state: normalizeWorkspaceState(workspace.state),
        }));
        return wrapSuccess(records);
      }
      case "/workspace/load": {
        const id = typeof payload === "object" && payload !== null ? (payload as { id?: string }).id : undefined;
        if (!id) {
          return wrapSuccess<WorkspaceRecord | null>(null);
        }
        const record = findWorkspace(id);
        return wrapSuccess(record ? { ...record, state: normalizeWorkspaceState(record.state) } : null);
      }
      case "/workspace/create": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { name, folderPath, state } = payload as { name: string; folderPath?: string; state: WorkspaceState };
        const existing = workspacesByName.get(name);
        const record = toRecord(name, state, existing ? { id: existing.id } : { folderPath });
        record.folderPath = folderPath ?? record.folderPath;
        storeRecord(record);
        return wrapSuccess({ ...record, state: normalizeWorkspaceState(record.state) });
      }
      case "/workspace/update": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { id, state } = payload as { id: string; state: WorkspaceState };
        const record = findWorkspace(id);
        if (!record) {
          return wrapError("Workspace not found");
        }
        record.state = normalizeWorkspaceState(state);
        record.updatedAt = Math.floor(Date.now() / 1000);
        record.lastAccessed = record.updatedAt;
        workspacesByName.set(record.name, record);
        workspacesById.set(record.id, record);
        return wrapSuccess(null);
      }
      case "/workspace/delete": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { id } = payload as { id: string };
        const record = findWorkspace(id);
        if (!record) {
          return wrapError("Workspace not found");
        }
        workspacesByName.delete(record.name);
        workspacesById.delete(record.id);
        return wrapSuccess(null);
      }
      case "/workspace/rename": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { id, newName } = payload as { id: string; newName: string };
        const record = findWorkspace(id);
        if (!record) {
          return wrapError("Workspace not found");
        }
        workspacesByName.delete(record.name);
        record.name = newName;
        storeRecord(record);
        return wrapSuccess(null);
      }
      case "/workspace/touch": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { id } = payload as { id: string };
        const record = findWorkspace(id);
        if (!record) {
          return wrapError("Workspace not found");
        }
        record.lastAccessed = Math.floor(Date.now() / 1000);
        return wrapSuccess(null);
      }
      case "/prefs/get": {
        if (payload && typeof payload === "object" && "key" in (payload as Record<string, unknown>)) {
          const key = (payload as { key?: string }).key;
          return wrapSuccess(key ? preferences.get(key) ?? null : null);
        }
        if (typeof payload === "string") {
          return wrapSuccess(preferences.get(payload) ?? null);
        }
        return wrapSuccess(null);
      }
      case "/prefs/set": {
        if (!payload || typeof payload !== "object") {
          return wrapError("Invalid payload");
        }
        const { key, value } = payload as { key: string; value: unknown };
        preferences.set(key, value);
        return wrapSuccess(true);
      }
      default: {
        if (previousIpc?.invoke) {
          return previousIpc.invoke(channel, ...args);
        }
        return wrapSuccess(null);
      }
    }
  });

  const send = jest.fn((channel: string, ...args: unknown[]) => {
    if (previousIpc?.send) {
      previousIpc.send(channel, ...args);
    }
  });

  const removeListener = jest.fn((channel: string, listener: (...args: unknown[]) => void) => {
    const registered = listeners.get(channel);
    if (registered) {
      registered.delete(listener);
      if (registered.size === 0) {
        listeners.delete(channel);
      }
    }
    if (previousIpc?.removeListener) {
      previousIpc.removeListener(channel, listener);
    }
  });

  const on = jest.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set());
    }
    listeners.get(channel)!.add(listener);
    if (previousIpc?.on) {
      previousIpc.on(channel, listener);
    }
  });

  const once = jest.fn((channel: string, listener: (...args: unknown[]) => void) => {
    const wrapper = (...handlerArgs: unknown[]) => {
      removeListener(channel, wrapper);
      listener(...handlerArgs);
    };
    on(channel, wrapper);
  });

  const emit = (channel: string, ...args: unknown[]) => {
    const registered = listeners.get(channel);
    if (!registered) {
      return;
    }
    for (const listener of registered) {
      listener(...args);
    }
  };

  const ipcRenderer: ElectronIpcRendererMock = {
    invoke,
    on,
    once,
    removeListener,
    send,
  };

  const electron = { ipcRenderer };
  Object.defineProperty(window, "electron", {
    value: electron,
    configurable: true,
    writable: true,
  });
  (window as Window & { __PF_ELECTRON_IPC__?: ElectronIpcRendererMock }).__PF_ELECTRON_IPC__ = ipcRenderer;

  return {
    ipcRenderer,
    setWorkspace: (name: string, state: WorkspaceState, overrides?: WorkspaceOverrides) => {
      const record = toRecord(name, state, overrides);
      return storeRecord(record);
    },
    getWorkspace: (name: string) => {
      const record = workspacesByName.get(name);
      return record ? { ...record, state: normalizeWorkspaceState(record.state) } : undefined;
    },
    listWorkspaces: () => Array.from(workspacesByName.values()).map((workspace) => ({
      ...workspace,
      state: normalizeWorkspaceState(workspace.state),
    })),
    emit,
    restore: () => {
      if (previousElectron) {
        Object.defineProperty(window, "electron", {
          value: previousElectron,
          configurable: true,
          writable: true,
        });
        (window as Window & { __PF_ELECTRON_IPC__?: ElectronIpcRendererMock }).__PF_ELECTRON_IPC__ = previousElectron.ipcRenderer;
      } else {
        delete (window as Window & { electron?: unknown }).electron;
      }
    },
    preferences,
  };
}
