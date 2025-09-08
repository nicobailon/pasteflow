import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

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

export default function useAgentThreads(opts: UseAgentThreadsOptions): UseAgentThreadsResult {
  const { currentWorkspace, selectedFolder, sessionId, getStatus, setSessionId, setHydratedMessages } = opts;

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);

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
        const listRes = listRaw as { success?: boolean; data?: { threads?: Array<{ sessionId: string }> } } | undefined;
        const threads = listRes && listRes.success ? (listRes.data?.threads || []) : [];
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
        const loaded = loadedRaw as { success?: boolean; data?: { sessionId?: string; messages?: unknown[] } | null } | undefined;
        const json = (loaded && 'success' in (loaded as any) && (loaded as any).success) ? (loaded as any).data : (loaded as { data?: { sessionId?: string; messages?: unknown[] } } | undefined)?.data;
        if (json && Array.isArray(json.messages)) {
          setSessionId(String(json.sessionId));
          setHydratedMessages(json.messages);
        } else {
          setSessionId(targetSession);
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
      const loaded: unknown = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:load', wsId ? { workspaceId: wsId, sessionId: session } : { workspaceId: '', sessionId: session });
      const json = (loaded && (loaded as any).success) ? (loaded as any).data : (loaded as any)?.data ?? loaded;
      setSessionId(session);
      if (json && typeof json === 'object' && Array.isArray((json as any).messages)) setHydratedMessages((json as any).messages as unknown[]);
      else setHydratedMessages([]);
      if (wsId) { try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: session }); } catch { /* ignore */ } }
    } catch { /* noop */ }
  }, [resolveWorkspaceId, setSessionId, setHydratedMessages, getStatus]);

  const deleteThread = useCallback(async (session: string) => {
    try {
      const wsId = await resolveWorkspaceId();
      await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:delete', wsId ? { workspaceId: wsId, sessionId: session } : { workspaceId: '', sessionId: session });
    } catch { /* ignore */ }
    if (sessionId === session) {
      try {
        const wsId = activeWorkspaceId;
        const listRes: unknown = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:list', wsId ? { workspaceId: wsId } : {});
        const threads: any[] = (listRes && (listRes as any).success) ? ((listRes as any).data?.threads || []) : [];
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
  }, [resolveWorkspaceId, sessionId, activeWorkspaceId, openThread, setSessionId, setHydratedMessages]);

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

