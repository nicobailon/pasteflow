import { useCallback, useEffect, useState, useRef, type Dispatch, type SetStateAction } from "react";

export interface UseAgentThreadsOptions {
  readonly currentWorkspace: string | null;
  readonly selectedFolder: string | null;
  readonly sessionId: string | null;
  readonly getStatus?: () => (string | null | undefined);
  readonly setSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setHydratedMessages: Dispatch<SetStateAction<unknown[]>>;
}

export interface UseAgentThreadsResult {
  readonly activeWorkspaceId: string | null;
  readonly setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly threadsRefreshKey: number;
  bumpThreadsRefreshKey: () => void;
  refreshActiveWorkspace: () => Promise<void>;
  resolveWorkspaceId: () => Promise<string | null>;
  openThread: (session: string) => Promise<void>;
  deleteThread: (session: string) => Promise<void>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function extractMessagesFromIpc(payload: unknown): unknown[] | null {
  // Accept shapes: { success: true, data: { messages: [] } } | { data: { messages: [] } } | { messages: [] }
  if (!isRecord(payload)) return null;
  // Case 1: envelope with explicit success flag
  if ('success' in payload) {
    const suc = (payload as Record<string, unknown>).success;
    if (suc === true && 'data' in payload && isRecord((payload as Record<string, unknown>).data)) {
      const data = (payload as Record<string, unknown>).data as Record<string, unknown>;
      const msgs = data.messages;
      return Array.isArray(msgs) ? (msgs as unknown[]) : null;
    }
  }
  // Case 2: envelope without success
  if ('data' in payload && isRecord((payload as Record<string, unknown>).data)) {
    const data = (payload as Record<string, unknown>).data as Record<string, unknown>;
    const msgs = data.messages;
    return Array.isArray(msgs) ? (msgs as unknown[]) : null;
  }
  // Case 3: direct thread object
  if ('messages' in payload) {
    const msgs = (payload as Record<string, unknown>).messages;
    return Array.isArray(msgs) ? (msgs as unknown[]) : null;
  }
  return null;
}

function extractErrorCodeFromIpc(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const err = (payload as Record<string, unknown>).error;
  return typeof err === 'string' && err.length > 0 ? err : null;
}

function extractThreadsFromIpc(payload: unknown): Array<{ sessionId: string }> {
  const coerce = (v: unknown): Array<{ sessionId: string }> => {
    if (!Array.isArray(v)) return [];
    const out: Array<{ sessionId: string }> = [];
    for (const item of v) {
      if (isRecord(item) && typeof item.sessionId === 'string') out.push({ sessionId: item.sessionId });
    }
    return out;
  };
  if (isRecord(payload)) {
    const rec = payload as Record<string, unknown>;
    // success envelope with data.threads
    if (('success' in rec) && rec.success === true && ('data' in rec) && isRecord(rec.data)) {
      const dataRec = rec.data as Record<string, unknown>;
      if ('threads' in dataRec) return coerce(dataRec.threads);
    }
    // envelope with data.threads, no explicit success
    if (('data' in rec) && isRecord(rec.data)) {
      const dataRec = rec.data as Record<string, unknown>;
      if ('threads' in dataRec) return coerce(dataRec.threads);
    }
    // direct threads field
    if ('threads' in rec) return coerce(rec.threads);
  }
  // direct array
  if (Array.isArray(payload)) return coerce(payload);
  return [];
}

export default function useAgentThreads(opts: UseAgentThreadsOptions): UseAgentThreadsResult {
  const { currentWorkspace, selectedFolder, sessionId, getStatus, setSessionId, setHydratedMessages } = opts;

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  useEffect(() => { activeWorkspaceIdRef.current = activeWorkspaceId; }, [activeWorkspaceId]);

  const refreshActiveWorkspace = useCallback(async () => {
    try {
      const res = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown>; on?: (ch: string, fn: (...a: unknown[]) => void) => unknown; removeListener?: (ch: string, fn: (...a: unknown[]) => void) => void }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'workspace.active' });
      const parsed = res as { success?: boolean; data?: unknown } | undefined;
      const wsId = parsed && parsed.success && typeof parsed.data === 'string' ? parsed.data : null;
      setActiveWorkspaceId(wsId || null);
    } catch {
      setActiveWorkspaceId(null);
    }
  }, []);

  const resolveWorkspaceId = useCallback(async (): Promise<string | null> => {
    if (activeWorkspaceId) return activeWorkspaceId;
    try {
      const prefRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'workspace.active' });
      const pref = prefRaw as { success?: boolean; data?: unknown } | undefined;
      const wsPref = pref && pref.success ? String(pref.data || '') : '';
      if (wsPref) {
        setActiveWorkspaceId(wsPref);
        return wsPref;
      }
    } catch { /* ignore */ }
    try {
      const listRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/workspace/list', {});
      const listRes = listRaw as { success?: boolean; data?: Array<{ id: string; name: string; folderPath: string }> } | Array<{ id: string; name: string; folderPath: string }> | undefined;
      const arr: Array<{ id: string; name: string; folderPath: string }> = Array.isArray(listRes)
        ? listRes
        : (listRes && 'success' in (listRes as any) && (listRes as any).success ? (listRes as any).data : []) as Array<{ id: string; name: string; folderPath: string }>;
      let found: { id: string; name: string; folderPath: string } | undefined;
      if (currentWorkspace) {
        found = arr.find((w) => w.name === currentWorkspace);
      }
      if (!found && selectedFolder) {
        found = arr.find((w) => w.folderPath === selectedFolder);
      }
      if (found) {
        setActiveWorkspaceId(found.id);
        return found.id;
      }
    } catch { /* ignore */ }
    return null;
  }, [activeWorkspaceId, currentWorkspace, selectedFolder]);

  // Keep activeWorkspaceId in sync with folder/workspace changes
  useEffect(() => {
    // If folder is cleared, disable panel immediately
    if (!selectedFolder) {
      setActiveWorkspaceId(null);
      setSessionId(null);
      setHydratedMessages([]);
      return;
    }
    void refreshActiveWorkspace();
  }, [selectedFolder, refreshActiveWorkspace, setSessionId, setHydratedMessages]);

  useEffect(() => {
    if (currentWorkspace) void refreshActiveWorkspace();
  }, [currentWorkspace, refreshActiveWorkspace]);

  // Listen for workspace load/open events and preference updates to stay in sync
  useEffect(() => {
    const onWsLoaded = () => { void refreshActiveWorkspace(); };
    const onDirectOpen = () => { void refreshActiveWorkspace(); };
    window.addEventListener('workspaceLoaded', onWsLoaded as unknown as EventListener);
    window.addEventListener('directFolderOpened', onDirectOpen as unknown as EventListener);
    let prefUpdateHandler: ((...args: unknown[]) => void) | null = null;
    try {
      const ipc = (window as unknown as { electron?: { ipcRenderer?: { on?: (ch: string, fn: (...a: unknown[]) => void) => unknown; removeListener?: (ch: string, fn: (...a: unknown[]) => void) => void }}}).electron?.ipcRenderer;
      if (ipc?.on) {
        prefUpdateHandler = () => { void refreshActiveWorkspace(); };
        ipc.on('/prefs/get:update', prefUpdateHandler);
      }
    } catch { /* ignore */ }
    return () => {
      window.removeEventListener('workspaceLoaded', onWsLoaded as unknown as EventListener);
      window.removeEventListener('directFolderOpened', onDirectOpen as unknown as EventListener);
      try {
        const ipc = (window as unknown as { electron?: { ipcRenderer?: { removeListener?: (ch: string, fn: (...a: unknown[]) => void) => void }}}).electron?.ipcRenderer;
        if (ipc?.removeListener && prefUpdateHandler) ipc.removeListener('/prefs/get:update', prefUpdateHandler);
      } catch { /* ignore */ }
    };
  }, [refreshActiveWorkspace]);

  // Bootstrap: when workspace changes, load last open thread if not streaming and no active session
  useEffect(() => {
    const bootstrap = async (wsId: string | null) => {
      if (!wsId) return;
      const st = getStatus ? getStatus() : null;
      if (sessionId || st === 'streaming' || st === 'submitted') return;
      try {
        const listRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('agent:threads:list', { workspaceId: wsId });
        const threads = extractThreadsFromIpc(listRaw);
        let targetSession: string | null = null;
        try {
          const lastRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.lastSession.${wsId}` });
          const lastRes = lastRaw as { success?: boolean; data?: unknown } | undefined;
          const lastId = lastRes && lastRes.success && typeof lastRes.data === 'string' ? lastRes.data : null;
          if (lastId && threads.some((t) => t.sessionId === lastId)) targetSession = lastId;
        } catch { /* ignore */ }
        if (!targetSession && threads.length > 0) targetSession = threads[0].sessionId;
        if (!targetSession) return;
        const loadedRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('agent:threads:load', { workspaceId: wsId, sessionId: targetSession });
        const msgs = extractMessagesFromIpc(loadedRaw);
        if (msgs) {
          setSessionId(String(targetSession));
          setHydratedMessages(msgs);
        } else {
          // Keep previous behavior: set session but empty messages; log a concise warning
          setSessionId(targetSession);
          try {
            const code = extractErrorCodeFromIpc(loadedRaw) || 'LOAD_FAILED';
            // eslint-disable-next-line no-console
            console.warn('[UI] agent:threads:bootstrap load failed', { sessionId: targetSession, code });
          } catch { /* noop */ }
        }
        try { await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: targetSession }); } catch { /* noop */ }
      } catch { /* ignore */ }
    };
    void bootstrap(activeWorkspaceId);
  }, [activeWorkspaceId, sessionId, getStatus, setSessionId, setHydratedMessages]);

  const openThread = useCallback(async (session: string) => {
    try {
      const st = getStatus ? getStatus() : null;
      if (st === 'streaming' || st === 'submitted') { /* caller may interrupt upstream */ }
      const wsId = await resolveWorkspaceId();
      const params = wsId ? { workspaceId: wsId, sessionId: session } : { sessionId: session };
      const loaded: unknown = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:load', params);
      const msgs = extractMessagesFromIpc(loaded);
      setSessionId(session);
      if (msgs) {
        setHydratedMessages(msgs);
      } else {
        setHydratedMessages([]);
        try {
          const code = extractErrorCodeFromIpc(loaded) || 'LOAD_FAILED';
          // eslint-disable-next-line no-console
          console.warn('[UI] agent:threads:load failed', { sessionId: session, code });
          window.dispatchEvent(new CustomEvent('agent-thread-load-error', { detail: { sessionId: session, code } }));
        } catch { /* noop */ }
      }
      if (wsId) {
        try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: session }); } catch { /* ignore */ }
      }
    } catch (e) {
      try {
        // eslint-disable-next-line no-console
        console.warn('[UI] agent:threads:load threw', e);
        window.dispatchEvent(new CustomEvent('agent-thread-load-error', { detail: { sessionId: session, code: 'LOAD_EXCEPTION' } }));
      } catch { /* noop */ }
    }
  }, [resolveWorkspaceId, setSessionId, setHydratedMessages, getStatus]);

  const deleteThread = useCallback(async (session: string) => {
    try {
      const wsId = await resolveWorkspaceId();
      if (!wsId) {
        try {
          // eslint-disable-next-line no-console
          console.warn('[UI] agent:threads:delete failed (no active workspace)', { sessionId: session });
          window.dispatchEvent(new CustomEvent('agent-thread-delete-error', { detail: { sessionId: session, code: 'WORKSPACE_NOT_SELECTED' } }));
        } catch { /* noop */ }
      } else {
        await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:delete', { workspaceId: wsId, sessionId: session });
      }
    } catch { /* ignore */ }
    if (sessionIdRef.current === session) {
      try {
        const wsId = activeWorkspaceIdRef.current;
        const listRes: unknown = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:list', wsId ? { workspaceId: wsId } : {});
        const threads = extractThreadsFromIpc(listRes);
        if (threads.length > 0) {
          await openThread(threads[0].sessionId);
        } else {
          setSessionId(null);
          setHydratedMessages([]);
        }
      } catch {
        setSessionId(null);
        setHydratedMessages([]);
      }
    }
    setThreadsRefreshKey((x) => x + 1);
  }, [resolveWorkspaceId, openThread, setSessionId, setHydratedMessages]);

  return {
    activeWorkspaceId,
    setActiveWorkspaceId,
    threadsRefreshKey,
    bumpThreadsRefreshKey: () => setThreadsRefreshKey((x) => x + 1),
    refreshActiveWorkspace,
    resolveWorkspaceId,
    openThread,
    deleteThread,
  };
}

