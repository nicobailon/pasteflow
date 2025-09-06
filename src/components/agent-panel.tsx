import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import useAgentPanelResize from "../hooks/use-agent-panel-resize";
import AgentChatInputWithMention from "./agent-chat-input";
import AgentAttachmentList from "./agent-attachment-list";
import AgentToolCalls from "./agent-tool-calls";
import IntegrationsModal from "./integrations-modal";
import ModelSelector from "./model-selector";
import { ArrowUp, List as ListIcon, Plus as PlusIcon, Info as InfoIcon } from "lucide-react";
import { TOKEN_COUNTING } from "@constants";
import ModelSettingsModal from "./model-settings-modal";
import { Settings as SettingsIcon } from "lucide-react";
import AgentAlertBanner from "./agent-alert-banner";
import type { FileData } from "../types/file-types";
import { extname } from "../file-ops/path";
import "./agent-panel.css";
import { requestFileContent } from "../handlers/electron-handlers";
import AgentThreadList from "./agent-thread-list";

// Strict helper types for IPC and preferences
type PrefsGetResponse<T> = { success: true; data: T } | { success: false; error?: string };
type ThreadsListItem = {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  filePath: string;
};
type ThreadsListResponse = { success: true; data: { threads: ThreadsListItem[] } } | { success: false; error?: string };
type ThreadLoadResponse = { success: true; data: { sessionId: string; messages: unknown[] } | null } | { success: false; error?: string } | { data?: { sessionId?: string; messages?: unknown[] } };
type WorkspaceListItem = { id: string; name: string; folderPath: string };
type WorkspaceListResponse = { success: true; data: WorkspaceListItem[] } | { success: false; error?: string } | WorkspaceListItem[];

type AgentAttachment = {
  path: string;
  content?: string;
  tokenCount?: number;
  lines?: { start: number; end: number } | null;
};

export type AgentPanelProps = {
  /** Optional: allow parent to hide panel in tests */
  hidden?: boolean;
  /** Agent autocomplete data (read-only) */
  allFiles?: FileData[];
  selectedFolder?: string | null;
  /** Current workspace name (truthy when a workspace is active) */
  currentWorkspace?: string | null;
  /** Load file content for a given absolute path (renderer bridge) */
  loadFileContent?: (path: string) => Promise<void>;
};

/**
 * Minimal Phase 1 Agent Panel scaffolding.
 * - Left-docked, resizable column
 * - Always mounted (integrated in src/index.tsx)
 * - Basic input + message rendering using @ai-sdk/react useChat
 *
 * This is intentionally slim for Phase 1; richer UI comes in follow-ups.
 */
const AgentPanel = ({ hidden, allFiles = [], selectedFolder = null, currentWorkspace = null, loadFileContent }: AgentPanelProps) => {
  const { agentWidth, handleResizeStart } = useAgentPanelResize(320);

  // Local attachment state (message-scoped)
  const [pendingAttachments, setPendingAttachments] = useState<Map<string, AgentAttachment>>(new Map());

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Track when a turn starts to compute renderer-side latency if server usage is missing
  const turnStartRef = useRef<number | null>(null);

  // Bridge provided by preload/IPC (fallback for tests/dev)
  function useApiInfo() {
    const info = (window as any).__PF_API_INFO || {};
    const apiBase = typeof info.apiBase === "string" ? info.apiBase : "http://localhost:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }

  // Initial context from Content Area hand-off
  const lastInitialRef = useRef<any | null>(null);
  const { apiBase, authToken } = useApiInfo();
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorInfo, setErrorInfo] = useState<null | {
    status: number;
    code?: string;
    message?: string;
    details?: any;
  }>(null);
  const [notices, setNotices] = useState<{ id: string; variant: 'warning' | 'info'; message: string }[]>([]);
  const hadErrorRef = useRef(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState<boolean | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hydratedMessages, setHydratedMessages] = useState<any[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSwitchingThread, setIsSwitchingThread] = useState(false);
  const [awaitingBind, setAwaitingBind] = useState(false);
  const [queuedFirstSend, setQueuedFirstSend] = useState<string | null>(null);

  // Usage telemetry state
  type UsageRow = { id: number; session_id: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; cost_usd: number | null; created_at: number };
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [lastUsage, setLastUsage] = useState<UsageRow | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  // Panel enabled only when a workspace is active and a folder is selected
  const panelEnabled = useMemo<boolean>(() => {
    // Gate visually by app-level workspace presence + folder; use id for thread operations
    return Boolean(currentWorkspace && selectedFolder);
  }, [currentWorkspace, selectedFolder]);

  // Helper to refresh the active workspace from preferences
  const refreshActiveWorkspace = useCallback(async () => {
    try {
      const res = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown>; on?: (ch: string, fn: (...a: unknown[]) => void) => unknown; removeListener?: (ch: string, fn: (...a: unknown[]) => void) => void }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'workspace.active' });
      const parsed = res as PrefsGetResponse<string> | undefined;
      const wsId = parsed && parsed.success && typeof parsed.data === 'string' ? parsed.data : null;
      setActiveWorkspaceId(wsId || null);
    } catch {
      setActiveWorkspaceId(null);
    }
  }, []);

  // Fallback: resolve workspace id by listing and matching against name or folder
  const resolveWorkspaceId = useCallback(async (): Promise<string | null> => {
    if (activeWorkspaceId) return activeWorkspaceId;
    try {
      // Try preference first
      const prefRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'workspace.active' });
      const pref = prefRaw as PrefsGetResponse<string> | undefined;
      const wsPref = pref && pref.success ? String(pref.data || '') : '';
      if (wsPref) {
        setActiveWorkspaceId(wsPref);
        return wsPref;
      }
    } catch { /* ignore */ }
    try {
      const listRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/workspace/list', {});
      const listRes = listRaw as WorkspaceListResponse | undefined;
      const arr: WorkspaceListItem[] = Array.isArray(listRes) ? listRes as WorkspaceListItem[] : (listRes && 'success' in (listRes as any) && (listRes as any).success ? (listRes as any).data : []) as WorkspaceListItem[];
      let found: WorkspaceListItem | undefined;
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

  // Keep activeWorkspaceId in sync with app folder/workspace changes
  useEffect(() => {
    let cancelled = false;
    // If folder is cleared, disable panel immediately
    if (!selectedFolder) {
      setActiveWorkspaceId(null);
      setSessionId(null);
      setHydratedMessages([]);
      return () => { cancelled = true; };
    }
    void refreshActiveWorkspace();
    return () => { cancelled = true; };
  }, [selectedFolder, refreshActiveWorkspace]);

  // When the app-level workspace changes, refresh id from preferences
  useEffect(() => {
    if (currentWorkspace) {
      void refreshActiveWorkspace();
    }
  }, [currentWorkspace, refreshActiveWorkspace]);

  // Also listen for workspace load/open events and preference updates to stay in sync
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

  // Note: workspace bootstrap is done after useChat definition (below) to avoid TDZ on status

  // Prevent concurrent session creation and provide an explicit ensure API
  const creatingSessionRef = useRef<Promise<string | null> | null>(null);
  // Minimal session creation used by auto/first-send; snapshotting happens onFinish
  async function startSessionBasic(): Promise<string | null> {
    try {
      const res: unknown = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('agent:start-session', {});
      const id = (res && (res as { success?: boolean; data?: { sessionId?: string } }).success)
        ? (res as { data?: { sessionId?: string } }).data?.sessionId
        : ((res as { data?: { sessionId?: string } } | undefined)?.data?.sessionId ?? (res as { sessionId?: string } | undefined)?.sessionId);
      if (typeof id !== 'string' || id.trim().length === 0) return null;
      setSessionId(id);
      setHydratedMessages([]);
      return id;
    } catch {
      return null;
    }
  }
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (creatingSessionRef.current) return creatingSessionRef.current;
    const p = startSessionBasic();
    creatingSessionRef.current = p.then((id) => { creatingSessionRef.current = null; return id; });
    return creatingSessionRef.current;
  }, [sessionId]);

  // Auto-initialize a new chat session when the panel becomes enabled and no session exists
  const hasAutoInitializedRef = useRef(false);
  const autoInitAttemptsRef = useRef(0);
  useEffect(() => {
    if (!panelEnabled) {
      hasAutoInitializedRef.current = false;
      autoInitAttemptsRef.current = 0;
      return;
    }
    if (sessionId) return; // already active
    if (hasAutoInitializedRef.current) return; // guard
    // Try to create a new chat session automatically
    (async () => {
      const id = await ensureSession();
      if (id) {
        hasAutoInitializedRef.current = true;
        autoInitAttemptsRef.current = 0;
      } else {
        // Retry a few times to handle late workspace id/DB readiness
        if (autoInitAttemptsRef.current < 5) {
          autoInitAttemptsRef.current += 1;
          setTimeout(async () => {
            if (!hasAutoInitializedRef.current && panelEnabled && !sessionId) {
              const id2 = await ensureSession();
              if (id2) {
                hasAutoInitializedRef.current = true;
                autoInitAttemptsRef.current = 0;
              }
            }
          }, 500);
        }
      }
    })();
  }, [panelEnabled, sessionId, ensureSession]);

  const { messages, sendMessage, status, stop } = useChat({
    api: `${apiBase}/api/v1/chat`,
    headers: { Authorization: authToken ? `Bearer ${authToken}` : undefined },
    id: sessionId || undefined,
    initialMessages: hydratedMessages,
    // Override fetch to ensure we always target the local API and include auth
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const info = (window as any).__PF_API_INFO || {};
        const base = typeof info.apiBase === "string" ? info.apiBase : apiBase;
        const token = typeof info.authToken === "string" ? info.authToken : authToken;
        const url = `${base}/api/v1/chat`;
        // Preserve all headers provided by useChat (e.g., Content-Type, Accept) and add ours
        const merged = new Headers(init?.headers as HeadersInit | undefined);
        if (token) merged.set('Authorization', `Bearer ${token}`);
        if (sessionId) merged.set('X-Pasteflow-Session', sessionId);
        return fetch(url, { ...init, headers: merged }).then(async (res) => {
          // Surface server advisories as UI banners
          try {
            const warn = res.headers.get('x-pasteflow-warning');
            if (warn) {
              const msg = res.headers.get('x-pasteflow-warning-message')
                || (warn === 'temperature-ignored' ? 'The temperature setting is not supported for this reasoning model and was ignored.' : String(warn));
              setNotices((prev) => {
                // de-duplicate by id
                if (prev.some((n) => n.id === warn)) return prev;
                return [...prev, { id: warn, variant: 'warning', message: msg }];
              });
            }
          } catch { /* noop */ }
          if (!res.ok) {
            let parsed: any = null;
            let text: string | null = null;
            try { parsed = await res.clone().json(); } catch { /* not json */ }
            if (!parsed) { try { text = await res.text(); } catch { /* ignore */ } }
            const apiErr = parsed && typeof parsed === 'object' && parsed.error ? parsed.error : null;
            const err: any = new Error(
              (apiErr?.message as string) || res.statusText || 'Request failed'
            );
            err.status = res.status;
            err.code = (apiErr?.code as string) || undefined;
            err.body = parsed || text || null;
            throw err;
          }
          return res;
        });
      } catch {
        return fetch(input, init);
      }
    },
    // Attach structured envelope without changing user text embeddings
    prepareSendMessagesRequest: ({ messages, requestBody }: any) => {
      const dynamic = buildDynamicFromAttachments(pendingAttachments);
      const envelope = {
        version: 1 as const,
        initial: lastInitialRef.current || undefined,
        dynamic,
        workspace: selectedFolder || null,
      };
      return { ...requestBody, messages, context: envelope };
    },
    onFinish: async (finishInfo: any) => {
      try {
        if (sessionId) {
          try { console.log('[UI][Telemetry] onFinish: snapshot + usage refresh start', { sessionId }); } catch { /* noop */ }
          const [p, m] = await Promise.all([
            (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' }),
            (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' }),
          ]);
          const provider = (p && p.success && typeof p.data === 'string') ? p.data : undefined;
          const model = (m && m.success && typeof m.data === 'string') ? m.data : undefined;
          // Retry snapshot persist a few times to tolerate DB readiness and preference races
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const wsId = await resolveWorkspaceId();
              const res = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:saveSnapshot', {
                sessionId,
                workspaceId: wsId || undefined,
                messages: (finishInfo && finishInfo.messages) ? finishInfo.messages : undefined,
                meta: { model, provider },
              });
              if (res && typeof res === 'object' && 'success' in res && (res as any).success === false) {
                await new Promise((r) => setTimeout(r, 200));
                continue;
              }
              if (wsId) {
                try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: sessionId }); } catch { /* ignore */ }
              }
              setThreadsRefreshKey((x) => x + 1);
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 200));
            }
          }

          // Renderer-side telemetry append (usage + latency)
          try {
            const uRoot = finishInfo && (finishInfo.usage || finishInfo.data?.usage) ? (finishInfo.usage || finishInfo.data?.usage) : null;
            const input = (uRoot && typeof uRoot.inputTokens === 'number') ? uRoot.inputTokens : null;
            const output = (uRoot && typeof uRoot.outputTokens === 'number') ? uRoot.outputTokens : null;
            const total = (uRoot && typeof uRoot.totalTokens === 'number') ? uRoot.totalTokens : ((input != null && output != null) ? input + output : null);
            const latency = (turnStartRef.current && typeof turnStartRef.current === 'number') ? (Date.now() - turnStartRef.current) : null;
            if (input != null || output != null || total != null || latency != null) {
              await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:append', { sessionId, inputTokens: input, outputTokens: output, totalTokens: total, latencyMs: latency });
              try { console.log('[UI][Telemetry] renderer append usage', { sessionId, input, output, total, latency }); } catch { /* noop */ }
            } else {
              try { console.log('[UI][Telemetry] renderer append skipped (no usage payload)'); } catch { /* noop */ }
            }
          } catch (e) {
            try { console.warn('[UI][Telemetry] renderer append failed', e); } catch { /* noop */ }
          }
        }
      } catch { /* ignore */ }
      // Clear one-shot attachments
      setPendingAttachments(new Map());
      // Only clear error if there wasn't an error signaled in this turn
      if (!hadErrorRef.current) {
        setErrorStatus(null);
        setErrorInfo(null);
      }
      hadErrorRef.current = false;
      // Refresh usage immediately after finish
      try {
        if (sessionId) {
          const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
          if (res && res.success && Array.isArray(res.data)) {
            setUsageRows(res.data as UsageRow[]);
            setLastUsage((res.data as UsageRow[])[(res.data as UsageRow[]).length - 1] || null);
            try { console.log('[UI][Telemetry] onFinish: usage refreshed', { count: (res.data as UsageRow[]).length }); } catch { /* noop */ }
          }
        }
      } catch { /* ignore */ }
    },
    onError: (err: any) => {
      const code = typeof err?.status === "number" ? err.status : (typeof err?.code === "number" ? err.code : null);
      hadErrorRef.current = true;
      // Capture any structured error returned by backend
      try {
        const payload = (err?.body && typeof err.body === 'object') ? err.body : null;
        const e = payload?.error || null;
        if (code && e && typeof e === 'object') {
          setErrorInfo({ status: code, code: String(e.code || ''), message: String(e.message || ''), details: e.details });
        } else if (code) {
          const msg = (typeof err?.message === 'string' && err.message) ? err.message : undefined;
          const c = (typeof err?.code === 'string' && err.code) ? err.code : undefined;
          setErrorInfo({ status: code, code: c, message: msg });
        }
      } catch { /* noop */ }
      if (code === 429) {
        setErrorStatus(429);
        return;
      }
      // Prefer explicit 503 from server
      if (code === 503) {
        setErrorStatus(503);
        return;
      }
      // Heuristics: detect provider config errors by name/message
      try {
        const name = String(err?.name || "");
        const msg = String(err?.message || "").toLowerCase();
        if (name.includes("LoadAPIKeyError") || msg.includes("api key is missing") || msg.includes("api-key is missing") || code === 401 || code === 403) {
          setErrorStatus(503);
          return;
        }
      } catch { /* noop */ }
      // Fallback: if no stored key, surface Configure banner
      try {
        void (async () => {
          try {
            const res: any = await window.electron.ipcRenderer.invoke('/prefs/get', { key: 'integrations.openai.apiKey' });
            const value = (res && typeof res === 'object' && 'success' in res) ? (res as any).data : res;
            const hasKey = Boolean(value && (
              (typeof value === 'string' && value.trim().length > 0) ||
              (value && typeof value === 'object' && (value as any).__type === 'secret' && (value as any).v === 1)
            ));
            if (!hasKey) setErrorStatus(503);
          } catch {
            // If we cannot check, leave as-is
          }
        })();
      } catch { /* noop */ }

      // Generic banner for other HTTP errors
      if (typeof code === 'number' && code >= 400 && code <= 599) {
        setErrorStatus(code);
        return;
      }
      // Fallback unknown error
      setErrorStatus(500);
    }
  } as any);

  // Update usage list on session change
  useEffect(() => {
    (async () => {
      try {
        if (!sessionId) { setUsageRows([]); setLastUsage(null); return; }
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
        if (res && res.success && Array.isArray(res.data)) {
          setUsageRows(res.data as UsageRow[]);
          setLastUsage((res.data as UsageRow[])[(res.data as UsageRow[]).length - 1] || null);
          try { console.log('[UI][Telemetry] fetched usage rows', { sessionId, count: (res.data as UsageRow[]).length }); } catch { /* noop */ }
        } else {
          try { console.log('[UI][Telemetry] fetched usage rows: empty or error', { sessionId, result: res }); } catch { /* noop */ }
        }
      } catch { /* ignore */ }
    })();
  }, [sessionId]);

  // When streaming completes, refresh last usage quickly
  const lastStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = status as string | null;
    const finishedNow = Boolean(prev && (prev === 'streaming' || prev === 'submitted') && !(status === 'streaming' || status === 'submitted'));
    if (finishedNow && sessionId) {
      setTimeout(async () => {
        try {
          const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
          if (res && res.success && Array.isArray(res.data)) {
            setUsageRows(res.data as UsageRow[]);
            setLastUsage((res.data as UsageRow[])[(res.data as UsageRow[]).length - 1] || null);
            try { console.log('[UI][Telemetry] status change refresh', { prev, next: status, count: (res.data as UsageRow[]).length }); } catch { /* noop */ }
          }
        } catch { /* ignore */ }
      }, 75);
    }
  }, [status, sessionId]);

  // Fetch provider/model for cost hints
  useEffect(() => {
    (async () => {
      try {
        const [p, m] = await Promise.all([
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' }),
        ]);
        const prov = p && p.success && typeof p.data === 'string' ? p.data : null;
        const mid = m && m.success && typeof m.data === 'string' ? m.data : null;
        setProvider(prov);
        setModelId(mid);
        try { console.log('[UI][Telemetry] provider/model', { provider: prov, model: mid }); } catch { /* noop */ }
      } catch { /* ignore */ }
    })();
  }, []);

  function formatLatency(ms: number | null | undefined): string {
    if (!ms || ms <= 0) return "—";
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms}ms`;
  }

  function formatTokens(u?: Partial<UsageRow> | null): string {
    if (!u) return "—";
    const i = u.input_tokens ?? null;
    const o = u.output_tokens ?? null;
    const t = (typeof u.total_tokens === 'number') ? u.total_tokens : ((i != null && o != null) ? (i + o) : null);
    if (i == null && o == null && t == null) return "—";
    if (i != null && o != null) return `${i}/${o} · ${t}`;
    if (t != null) return `${t}`;
    return `${i ?? '—'}/${o ?? '—'}`;
  }

  // Very rough cost hint (optional). Extend map as needed.
  function estimateCostUSD(u?: Partial<UsageRow> | null): string | null {
    if (!u) return null;
    const i = u.input_tokens ?? 0;
    const o = u.output_tokens ?? 0;
    const t = (typeof u.total_tokens === 'number') ? u.total_tokens : (i + o);
    if (!t) return null;
    const m = (modelId || '').toLowerCase();
    // Default approximate rates per 1K tokens
    const perK: { in: number; out: number } = m.includes('gpt-4o-mini') ? { in: 0.0005, out: 0.0015 } :
      m.includes('gpt-5') ? { in: 0.005, out: 0.015 } :
      m.includes('haiku') ? { in: 0.0008, out: 0.0024 } : { in: 0.001, out: 0.003 };
    const cost = (i / 1000) * perK.in + (o / 1000) * perK.out;
    return `$${cost.toFixed(cost < 0.01 ? 3 : 2)}`;
  }

  // Log lastUsage updates for visibility
  useEffect(() => {
    try { console.log('[UI][Telemetry] lastUsage updated', lastUsage); } catch { /* noop */ }
  }, [lastUsage]);

  // Estimate tokens for a message index (assistant + preceding user)
  function estimateTokensForAssistant(idx: number): { input: number | null; output: number | null; total: number | null } {
    try {
      const m = messages[idx];
      if (!m || m.role !== 'assistant') return { input: null, output: null, total: null };
      const outText = extractVisibleTextFromMessage(m);
      const output = outText ? Math.ceil(outText.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
      // find nearest preceding user message
      let inputText = '';
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') { inputText = extractVisibleTextFromMessage(messages[i]); break; }
      }
      const input = inputText ? Math.ceil(inputText.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
      const total = input + output;
      return { input, output, total };
    } catch { return { input: null, output: null, total: null }; }
  }

  // Aggregate session totals from persisted usage; fallback to estimate from messages when needed
  const sessionTotals = useMemo(() => {
    // Prefer DB rows only if they actually contain any token numbers
    try {
      if (Array.isArray(usageRows) && usageRows.length > 0) {
        const hasAnyToken = usageRows.some(r => (
          (typeof r.input_tokens === 'number' && r.input_tokens > 0) ||
          (typeof r.output_tokens === 'number' && r.output_tokens > 0) ||
          (typeof r.total_tokens === 'number' && r.total_tokens > 0)
        ));
        if (hasAnyToken) {
          let inSum = 0, outSum = 0, totalSum = 0; let approx = false; let costSum = 0; let anyCost = false;
          for (const r of usageRows) {
            if (r.input_tokens == null || r.output_tokens == null || r.total_tokens == null) approx = true;
            inSum += r.input_tokens ?? 0;
            outSum += r.output_tokens ?? 0;
            totalSum += (typeof r.total_tokens === 'number' ? r.total_tokens : ((r.input_tokens ?? 0) + (r.output_tokens ?? 0)));
            if (typeof r.cost_usd === 'number' && Number.isFinite(r.cost_usd)) { costSum += r.cost_usd; anyCost = true; }
          }
          return { inSum, outSum, totalSum, approx, costUsd: anyCost ? costSum : null } as const;
        }
      }
    } catch { /* noop */ }
    // Fallback estimation from messages: user = input; assistant = output
    try {
      let inSum = 0, outSum = 0;
      for (const m of messages as any[]) {
        const txt = extractVisibleTextFromMessage(m);
        const t = txt ? Math.ceil(txt.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
        if (m?.role === 'user') inSum += t; else if (m?.role === 'assistant') outSum += t;
      }
      return { inSum, outSum, totalSum: inSum + outSum, approx: true, costUsd: null } as const;
    } catch {
      return { inSum: 0, outSum: 0, totalSum: 0, approx: true, costUsd: null } as const;
    }
  }, [usageRows, messages]);

  // Load last/open thread when workspace changes, but never clobber an active session
  useEffect(() => {
    let cancelled = false;
    const bootstrapThreadsForWorkspace = async (wsId: string | null) => {
      if (!wsId) return;
      // Do not change threads while a session is active or a message is streaming
      if (sessionId || status === 'streaming' || status === 'submitted') return;
      try {
        const listRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('agent:threads:list', { workspaceId: wsId });
        const listRes = listRaw as ThreadsListResponse | undefined;
        const threads = listRes && listRes.success ? (listRes.data?.threads || []) : [];
        let targetSession: string | null = null;
        try {
          const lastRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.lastSession.${wsId}` });
          const lastRes = lastRaw as PrefsGetResponse<string> | undefined;
          const lastId = lastRes && lastRes.success && typeof lastRes.data === 'string' ? lastRes.data : null;
          if (lastId && threads.some((t) => t.sessionId === lastId)) targetSession = lastId;
        } catch { /* ignore */ }
        if (!targetSession && threads.length > 0) targetSession = threads[0].sessionId;
        if (cancelled || !targetSession) return;
        const loadedRaw = await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('agent:threads:load', { sessionId: targetSession });
        const loaded = loadedRaw as ThreadLoadResponse | undefined;
        const json = (loaded && 'success' in loaded && loaded.success) ? loaded.data : (loaded as { data?: { sessionId?: string; messages?: unknown[] } } | undefined)?.data;
        if (json && Array.isArray(json.messages)) {
          setSessionId(String(json.sessionId));
          setHydratedMessages(json.messages as unknown[]);
        } else {
          setSessionId(targetSession);
        }
        try { await (window as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, data?: unknown) => Promise<unknown> }}}).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: targetSession }); } catch { /* noop */ }
      } catch {
        // ignore bootstrapping errors, do not clobber active state
      }
    };
    void bootstrapThreadsForWorkspace(activeWorkspaceId);
    return () => { cancelled = true; };
  }, [activeWorkspaceId, sessionId, status]);

  // Interruption markers persist in the thread to indicate aborted turns
  const [interruptions, setInterruptions] = useState<Map<number, { target: 'pre-assistant' | 'assistant'; ts: number }>>(new Map());

  const computeInterruptionTarget = useCallback((): { index: number; target: 'pre-assistant' | 'assistant' } | null => {
    try {
      if (!Array.isArray(messages) || messages.length === 0) return null;
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if ((status === 'streaming') && last?.role === 'assistant') {
        return { index: lastIdx, target: 'assistant' };
      }
      for (let i = lastIdx; i >= 0; i--) {
        if (messages[i]?.role === 'user') return { index: i, target: 'pre-assistant' };
      }
      return { index: lastIdx, target: 'pre-assistant' };
    } catch {
      return null;
    }
  }, [messages, status]);

  const interruptNow = useCallback(() => {
    const pos = computeInterruptionTarget();
    if (pos) {
      setInterruptions((prev) => {
        const next = new Map(prev);
        const existing = next.get(pos.index);
        if (!existing || existing.target !== pos.target) {
          next.set(pos.index, { target: pos.target, ts: Date.now() });
        }
        return next;
      });
    }
    try { stop(); } catch { /* noop */ }
  }, [computeInterruptionTarget, stop]);

  // Esc key to interrupt while submitted/streaming
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (status === 'streaming' || status === 'submitted')) {
        interruptNow();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status, interruptNow]);

  // Global Esc cancels streaming
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (status === 'streaming' || status === 'submitted')) {
        try { stop(); } catch { /* noop */ }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status, stop]);

  // Local input state for composer (since useChat v2 doesn't expose input/setInput)
  const [composer, setComposer] = useState("");

  // Global event to open Integrations modal from header/menu
  useEffect(() => {
    const handler = () => setShowIntegrations(true);
    window.addEventListener('pasteflow:open-integrations', handler as EventListener);
    return () => window.removeEventListener('pasteflow:open-integrations', handler as EventListener);
  }, []);

  // Clear provider-config error when preferences update (e.g., after saving API key)
  useEffect(() => {
    try {
      const checkPresence = async () => {
        try {
          const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openai.apiKey' });
          const value = (res && typeof res === 'object' && 'success' in res) ? (res as any).data : res;
          const has = Boolean(value && (
            (typeof value === 'string' && value.trim().length > 0) ||
            (value && typeof value === 'object' && (value as any).__type === 'secret' && (value as any).v === 1)
          ));
          setHasOpenAIKey(has);
          if (has) setErrorStatus(null);
        } catch {
          // leave as-is on failure
        }
      };

      // Initial presence check
      checkPresence();

      const cb = (_: unknown) => { checkPresence(); };
      (window as any).electron?.receive?.('/prefs/get:update', cb as any);
      return () => {
        try { (window as any).electron?.ipcRenderer?.removeListener?.('/prefs/get:update', cb as any); } catch { /* noop */ }
      };
    } catch { /* noop */ }
  }, []);

  // Helper: retry ensureSession a few times before giving up
  const ensureSessionOrRetry = useCallback(async (maxAttempts: number = 8, delayMs: number = 250): Promise<string | null> => {
    setIsStartingChat(true);
    try {
      for (let i = 0; i < maxAttempts; i++) {
        const id = await ensureSession();
        if (id) return id;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    } finally {
      setIsStartingChat(false);
    }
  }, [ensureSession]);

  // Receive "Send to Agent" event from other parts of the UI
  useEffect(() => {
    const handler = async (e: Event) => {
      const ce = e as CustomEvent<any>;
      if (!ce?.detail) return;
      if (!sessionId) {
        const id = await ensureSessionOrRetry();
        if (!id) return;
        await new Promise((r) => setTimeout(r, 0));
      }
      // Support legacy { text } shape
      if (typeof ce.detail.text === "string" && ce.detail.text.length > 0) {
        sendMessage({ text: ce.detail.text } as any);
        return;
      }
      // Structured hand-off with context envelope
      if (ce.detail.context && ce.detail.context.version === 1) {
        lastInitialRef.current = ce.detail.context.initial || null;
        const summary: string = buildInitialSummaryMessage(ce.detail.context);
        // Auto-submit a summary message (no content embedding)
        sendMessage({ text: summary } as any);
      }
    };
    window.addEventListener("pasteflow:send-to-agent", handler as EventListener);
    return () => window.removeEventListener("pasteflow:send-to-agent", handler as EventListener);
  }, [sendMessage, ensureSessionOrRetry, sessionId]);

  // Queue handling: if a send was queued during thread switching, flush it after binding
  useEffect(() => {
    if (!queuedFirstSend) return;
    if (awaitingBind || isSwitchingThread || !sessionId) return;
    // Flush the queued text now that session is ready
    sendMessage({ text: queuedFirstSend } as any);
    setQueuedFirstSend(null);
  }, [queuedFirstSend, awaitingBind, isSwitchingThread, sessionId, sendMessage]);

  // Detect code fence language based on file extension
  const detectLanguage = useCallback((path: string) => {
    const ext = extname(path) || "";
    const lang = ext.startsWith(".") ? ext.slice(1) : ext;
    return (lang || "text").toLowerCase();
  }, []);

  // Build condensed display text by replacing file content blocks with line-count summaries
  const condenseUserMessageForDisplay = useCallback((text: string) => {
    try {
      const pattern = /File:\s*(.+?)\n```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```/g;
      return text.replace(pattern, (_m, p1: string, _lang: string, body: string) => {
        const lines = body === "" ? 0 : body.split(/\r?\n/).length;
        return `File: ${p1}\n[File content: ${lines} lines]`;
      });
    } catch {
      return text;
    }
  }, []);

  // Ensure we have content for each attachment path (direct IPC fetch if needed)
  const ensureAttachmentContent = useCallback(async (path: string): Promise<string> => {
    // Try from attachments first
    const fromPending = pendingAttachments.get(path)?.content;
    if (typeof fromPending === "string") return fromPending;

    // Try from allFiles (already loaded)
    const fd = allFiles.find((f) => f.path === path);
    if (fd && fd.isContentLoaded && typeof fd.content === "string") {
      return fd.content;
    }

    // Directly request content via IPC to avoid stale prop re-reads
    try {
      const res = await requestFileContent(path);
      if (res?.success && typeof res.content === "string") {
        // Cache on pending attachments to avoid duplicate fetches within this turn
        setPendingAttachments((prev) => {
          const next = new Map(prev);
          const existing = next.get(path) || { path } as AgentAttachment;
          next.set(path, { ...existing, content: res.content });
          return next;
        });
        return res.content;
      }
    } catch {
      // ignore and fall through
    }

    // Optionally prime parent state (no synchronous value expected)
    try { await loadFileContent?.(path); } catch { /* noop */ }

    // Fallback: empty content
    return "";
  }, [allFiles, pendingAttachments, setPendingAttachments, loadFileContent]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const userText = composer.trim();
      if (!userText) return;

      // Ensure session, retrying if needed
      if (!sessionId || isStartingChat || isSwitchingThread || awaitingBind) {
        const id = await ensureSessionOrRetry();
        if (!id) {
          const nId = `chat-init-failed-${Date.now()}`;
          setNotices((prev) => [...prev, { id: nId, variant: 'warning', message: 'Could not start chat. Please try again.' }]);
          setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== nId)), 1800);
          return;
        }
        // If still binding/switching, queue the first send and return
        if (awaitingBind || isSwitchingThread) {
          // Prepare payload for queued send below
          const attachments = Array.from(pendingAttachments.values());
          const llmBlocks: string[] = [];
          for (const att of attachments) {
            const content = typeof att.content === "string" && att.content.length > 0 ? att.content : await ensureAttachmentContent(att.path);
            const lang = detectLanguage(att.path);
            llmBlocks.push(`File: ${att.path}\n\`\`\`${lang}\n${content}\n\`\`\``);
          }
          const llmTextBound = [...llmBlocks, userText].filter(Boolean).join("\n\n");
          setQueuedFirstSend(llmTextBound);
          setComposer("");
          return;
        }
        await new Promise((r) => setTimeout(r, 0));
      }

      // Use current pending attachments
      const attachments = Array.from(pendingAttachments.values());

      // Prepare LLM payload blocks and UI condensed blocks
      const llmBlocks: string[] = [];
      const uiBlocks: string[] = [];

      for (const att of attachments) {
        const content = typeof att.content === "string" && att.content.length > 0
          ? att.content
          : await ensureAttachmentContent(att.path);

        const lang = detectLanguage(att.path);
        const lines = content === "" ? 0 : content.split(/\r?\n/).length;

        // Full block for LLM payload
        llmBlocks.push(`File: ${att.path}\n\`\`\`${lang}\n${content}\n\`\`\``);

        // Condensed summary for UI (will also be computed at render as a guard)
        uiBlocks.push(`File: ${att.path}\n[File content: ${lines} lines]`);
      }

      // Build final strings — attachments first, then the user's message
      const llmText = [...llmBlocks, userText].filter(Boolean).join("\n\n");

      // Send to LLM with full contents (mark turn start for latency)
      try { turnStartRef.current = Date.now(); } catch { /* noop */ }
      sendMessage({ text: llmText } as any);

      // Clear local composer
      setComposer("");
    },
    [composer, pendingAttachments, detectLanguage, ensureAttachmentContent, sendMessage, sessionId, ensureSessionOrRetry, setNotices, isStartingChat, isSwitchingThread]
  );

  const tokenHint = useMemo(() => {
    const total = (composer.length || 0) + Array.from(pendingAttachments.values()).reduce((acc, a) => acc + (a.tokenCount || 0), 0);
    return `${total} chars`;
  }, [composer, pendingAttachments]);

  async function handleNewChat(isAuto?: boolean): Promise<string | null> {
    try {
      if (status === 'streaming' || status === 'submitted') { interruptNow(); }
    } catch { /* noop */ }
    try {
      if (!panelEnabled) return null;
      setIsSwitchingThread(true);
      setAwaitingBind(true);
      // First, persist current thread if one exists
      if (sessionId) {
        try {
          const [p, m] = await Promise.all([
            (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' }),
            (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' }),
          ]);
          const provider = (p && p.success && typeof p.data === 'string') ? p.data : undefined;
          const model = (m && m.success && typeof m.data === 'string') ? m.data : undefined;
          const wsId = await resolveWorkspaceId();
          await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:saveSnapshot', {
            sessionId,
            workspaceId: wsId || undefined,
            messages,
            meta: { model, provider },
          });
          setThreadsRefreshKey((x) => x + 1);
        } catch { /* ignore snapshot of previous */ }
      }

      const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:start-session', {});
      const id = (res && res.success) ? res.data?.sessionId : res?.data?.sessionId || res?.sessionId;
      if (typeof id !== 'string') return null;
      setSessionId(id);
      setHydratedMessages([]);
      // Defer preference update (agent.lastSession) until after first assistant response (onFinish)
      // Bind readiness handled by effect below

      // Visual feedback unless auto-init
      if (!isAuto) {
        const nId = `new-chat-${Date.now()}`;
        setNotices((prev) => [...prev, { id: nId, variant: 'info', message: 'New chat created' }]);
        // Auto-dismiss after a short delay
        setTimeout(() => {
          setNotices((prev) => prev.filter((n) => n.id !== nId));
        }, 2500);
      }
      return id;
    } catch {
      return null; /* noop */
    }
  }

  // Re-enable input only after React commit with the new session id
  useEffect(() => {
    if (awaitingBind && sessionId) {
      const t = setTimeout(() => {
        setIsSwitchingThread(false);
        setAwaitingBind(false);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [awaitingBind, sessionId]);

  // Prevent concurrent session creation and provide an explicit ensure API
  

  async function openThread(session: string) {
    try {
      if (status === 'streaming' || status === 'submitted') { interruptNow(); }
    } catch { /* noop */ }
    try {
      if (!panelEnabled) return;
      const loaded: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:load', { sessionId: session });
      const json = (loaded && loaded.success) ? loaded.data : loaded?.data ?? loaded;
      setSessionId(session);
      if (json && typeof json === 'object' && Array.isArray(json.messages)) setHydratedMessages(json.messages);
      else setHydratedMessages([]);
      const wsId = await resolveWorkspaceId();
      if (wsId) { try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.lastSession.${wsId}`, value: session }); } catch { /* ignore */ } }
      setShowThreads(false);
    } catch { /* noop */ }
  }

  async function deleteThread(session: string) {
    try {
      await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:delete', { sessionId: session });
    } catch { /* ignore */ }
    // If deleting current session, clear it
    if (sessionId === session) {
      try {
        const wsId = activeWorkspaceId;
        const listRes: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:threads:list', wsId ? { workspaceId: wsId } : {});
        const threads: any[] = (listRes && listRes.success) ? (listRes.data?.threads || []) : [];
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
  }

  if (hidden) return null;

  return (
    <div className="agent-panel" style={{ width: `${agentWidth}px` }} data-testid="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-title">Agent</div>
        {/* Session totals chip */}
        {(() => {
          const chipInput = sessionTotals.inSum;
          const chipOutput = sessionTotals.outSum;
          const chipTotal = sessionTotals.totalSum;
          const approx = sessionTotals.approx;
          const label = `${chipTotal} ${approx ? '(approx) ' : ''}tokens (in: ${chipInput}, out: ${chipOutput})`;
          const persistedCost = (typeof sessionTotals.costUsd === 'number' && Number.isFinite(sessionTotals.costUsd)) ? `$${sessionTotals.costUsd.toFixed(4)}` : null;
          const estimatedCost = (!persistedCost && (chipInput > 0 || chipOutput > 0)) ? (estimateCostUSD({ input_tokens: chipInput as any, output_tokens: chipOutput as any, total_tokens: chipTotal as any } as any) || null) : null;
          const costTxt = persistedCost || estimatedCost || null;
          // Keep the chip visible once a conversation starts, even if totals are 0 mid-stream
          const hasAnyMessages = Array.isArray(messages) && messages.length > 0;
          if (!hasAnyMessages && chipTotal <= 0 && !costTxt) return null;
          return (
            <div className="agent-usage-chip" title={`Session totals — Input: ${chipInput}, Output: ${chipOutput}, Total: ${chipTotal}${costTxt ? `, Cost: ${costTxt}` : ''}`}>
              <span className="dot" />
              <span>{label}</span>
              {costTxt && (<><span>·</span><span>{costTxt}</span></>)}
            </div>
          );
        })()}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="secondary" onClick={async () => { const ws = await resolveWorkspaceId(); if (ws) setActiveWorkspaceId(ws); setThreadsRefreshKey((x)=>x+1); setShowThreads(true); }} title="Threads" aria-label="Threads" disabled={!panelEnabled}>
            <ListIcon size={16} />
          </button>
          <button className="primary" onClick={handleNewChat} title="New Chat" aria-label="New Chat" disabled={!panelEnabled}>
            <PlusIcon size={16} />
          </button>
          <button className="secondary" onClick={() => setShowModelSettings(true)} title="Agent Settings" aria-label="Agent Settings" disabled={!panelEnabled}>
            <SettingsIcon size={16} />
          </button>
          {status === "streaming" || status === "submitted" ? (
            <button className="cancel-button" onClick={interruptNow} title="Stop" aria-label="Stop generation">Stop</button>
          ) : ((hasOpenAIKey === false || errorStatus === 503) ? (
              <button className="primary" onClick={() => setShowIntegrations(true)} title="Configure AI Provider" aria-label="Configure AI Provider" disabled={!panelEnabled}>Configure</button>
            ) : null)}
        </div>
      </div>

      <div className="agent-panel-body">
        {/* Disabled overlay when no workspace is active */}
        {!panelEnabled && (
          <div className="agent-panel-disabled-overlay" role="note">
            <div className="agent-disabled-title">No workspace open</div>
            <div className="agent-disabled-subtitle">Open a saved workspace or select a folder to create one.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="primary" onClick={() => window.dispatchEvent(new CustomEvent('pasteflow:open-workspaces'))}>Open Workspace</button>
              <button className="secondary" onClick={() => { try { window.electron?.ipcRenderer?.send('open-folder'); } catch { /* noop */ } }}>Open Folder</button>
            </div>
          </div>
        )}

        {/* Error and notice banners with specific, user-friendly messages */}
        {notices.map((n) => (
          <AgentAlertBanner
            key={n.id}
            variant={n.variant}
            message={n.message}
            onDismiss={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}
          />
        ))}
        {(() => {
          if (errorStatus === 503) {
            // Prefer structured info when available (e.g., unauthorized vs missing)
            const reason = String(errorInfo?.details?.reason || '').toLowerCase();
            const isUnauthorized = reason === 'unauthorized';
            const msg = isUnauthorized
              ? 'AI provider rejected the API key. Click Configure to update credentials.'
              : 'OpenAI API key is missing. Click Configure in the header to add it.';
            return (
              <AgentAlertBanner
                variant="error"
                message={msg}
                onDismiss={() => { setErrorStatus(null); setErrorInfo(null); }}
              />
            );
          }
          if (errorStatus === 429) {
            const msg = String(errorInfo?.message || '').toLowerCase();
            const quota = msg.includes('insufficient_quota') || msg.includes('exceeded your current quota') || msg.includes('quota');
            const display = quota
              ? (
                  <span>
                    OpenAI quota exceeded. Update your billing plan or switch provider. See provider dashboard for details.
                  </span>
                )
              : 'Rate limited (429). Please wait a moment and try again.';
            return (
              <AgentAlertBanner
                variant={quota ? 'error' : 'warning'}
                message={display}
                onDismiss={() => { setErrorStatus(null); setErrorInfo(null); }}
              />
            );
          }
          if (errorStatus !== null) {
            const baseMsg = errorInfo?.message && errorInfo.message.trim().length > 0
              ? errorInfo.message
              : 'Please check logs or try again.';
            const codeTxt = errorInfo?.code ? ` [${errorInfo.code}]` : '';
            return (
              <AgentAlertBanner
                variant="error"
                message={`Request failed (${errorStatus})${codeTxt}. ${baseMsg}`}
                onDismiss={() => { setErrorStatus(null); setErrorInfo(null); }}
              />
            );
          }
          return null;
        })()}
        <AgentAttachmentList
          pending={pendingAttachments}
          onRemove={(absPath) => {
            setPendingAttachments((prev) => {
              const n = new Map(prev);
              n.delete(absPath);
              return n;
            });
          }}
        />
        <div className="agent-messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="agent-banner">Start a conversation or send packed content.</div>
          ) : (
            messages.map((m: any, idx) => {
              // Extract user-visible text from SDK UI message shape
              const rawText = extractVisibleTextFromMessage(m);

              // Condense user messages that embed file code blocks
              const displayText =
                m?.role === "user" && typeof rawText === "string"
                  ? condenseUserMessageForDisplay(rawText)
                  : rawText;

              const it = interruptions.get(idx);
              const assistantInterrupted = Boolean(it && it.target === 'assistant' && m?.role === 'assistant');

              return (
                <div key={idx} style={{ marginBottom: 10, border: assistantInterrupted ? '1px dashed #d99' : undefined, borderRadius: assistantInterrupted ? 4 : undefined, background: assistantInterrupted ? 'rgba(255,0,0,0.03)' : undefined }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{m.role}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{displayText}</div>
                  {/* Minimal tool-call visualization beneath assistant messages */}
                  {m?.role === "assistant" ? <AgentToolCalls message={m} /> : null}
                  {/* User message token count (no latency) */}
                  {m?.role === 'user' && (() => {
                    try {
                      const userTok = rawText ? Math.ceil(rawText.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
                      const tip = `User message tokens: ${userTok} (approx)`;
                      return (
                        <div className="message-usage-row">
                          <span className="info-icon" aria-label="User token usage">
                            <InfoIcon size={12} />
                            <span className="tooltip-box">{tip}</span>
                          </span>
                          <span>{userTok} tokens</span>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                  {/* Usage info icon with tooltip */}
                  {(() => {
                    if (m?.role !== 'assistant') return null;
                    let aIdx = 0;
                    for (let i = 0; i <= idx; i++) { if (messages[i]?.role === 'assistant') aIdx += 1; }
                    const usageInfo = usageRows[aIdx - 1] as UsageRow | undefined;
                    if (!usageInfo) return null;
                    try {
                      console.log('[UI][Telemetry] assistant usage mapping', { messageIndex: idx, assistantIndex: aIdx, usage: usageInfo });
                    } catch { /* noop */ }
                    // Build tooltip contents with fallbacks
                    const approxFallback = (!usageInfo.input_tokens && !usageInfo.output_tokens && !usageInfo.total_tokens);
                    const approx = approxFallback ? estimateTokensForAssistant(idx) : null;
                    const inTok = usageInfo.input_tokens ?? approx?.input ?? null;
                    const outTok = usageInfo.output_tokens ?? approx?.output ?? null;
                    const totalTok = (typeof usageInfo.total_tokens === 'number') ? usageInfo.total_tokens : ((inTok != null && outTok != null) ? (inTok + outTok) : (approx?.total ?? null));
                    const latencyTxt = formatLatency(usageInfo.latency_ms);
                    const costTxt = (typeof usageInfo.cost_usd === 'number' && Number.isFinite(usageInfo.cost_usd)) ? `$${usageInfo.cost_usd.toFixed(4)}` : (estimateCostUSD(usageInfo) || null);
                    const tooltip = `Output tokens: ${outTok ?? '—'}${approx && usageInfo.output_tokens == null ? ' (approx)' : ''}\n` +
                      `Input tokens: ${inTok ?? '—'}${approx && usageInfo.input_tokens == null ? ' (approx)' : ''}\n` +
                      `Total tokens: ${totalTok ?? '—'}${approx && usageInfo.total_tokens == null ? ' (approx)' : ''}\n` +
                      `Latency: ${latencyTxt}${costTxt ? `\nCost: ${costTxt}` : ''}`;
                    const label = `${(outTok ?? '—')}${approx && usageInfo.output_tokens == null ? ' (approx)' : ''} tokens`;
                    return (
                      <div className="message-usage-row">
                        <span className="info-icon" aria-label="Token usage details">
                          <InfoIcon size={12} />
                          <span className="tooltip-box">{tooltip}</span>
                        </span>
                        <span>{label}</span>
                        <span>• {latencyTxt}</span>
                      </div>
                    );
                  })()}
                  {/* Interruption indicator */}
                  {it && (
                    <div style={{ marginTop: 4, fontStyle: 'italic', color: '#a00' }}>User interrupted</div>
                  )}
                </div>
              );
            })
          )}
          {/* Sticky status banner at the bottom of the messages pane */}
          <div className="agent-status-banner">
            {status === "streaming" || status === "submitted" ? "Streaming…" : "Ready"}
          </div>
        </div>

        <form className="agent-input-container" onSubmit={handleSubmit}>
          <AgentChatInputWithMention
            value={composer}
            onChange={setComposer}
            disabled={(!panelEnabled) || status === "streaming" || status === "submitted" || isStartingChat || isSwitchingThread}
            allFiles={allFiles}
            selectedFolder={selectedFolder}
            onFileMention={(absPath) =>
              setPendingAttachments((prev) => {
                const next = new Map(prev);
                if (!next.has(absPath)) next.set(absPath, { path: absPath, lines: null });
                return next;
              })
            }
            overlay={
              <>
                {(isStartingChat || isSwitchingThread) && (
                  <div className="agent-starting-chip" aria-live="polite" aria-atomic="true">
                    <div className="agent-spinner" />
                    <span>Starting chat…</span>
                  </div>
                )}
                <button
                  className="agent-input-submit"
                  type="submit"
                  title="Send"
                  aria-label="Send"
                  disabled={(!panelEnabled) || (status === "streaming" || status === "submitted") || isStartingChat || isSwitchingThread || !composer.trim()}
                >
                  <ArrowUp size={14} />
                </button>
              </>
            }
          />
          <div className="agent-input-underbar">
            <ModelSelector onOpenSettings={() => setShowModelSettings(true)} />
          </div>
        </form>
      </div>

      <button
        className="agent-panel-resize-handle"
        onMouseDown={handleResizeStart}
        aria-label="Resize agent panel"
        title="Drag to resize agent panel"
      />

      <IntegrationsModal isOpen={showIntegrations} onClose={() => setShowIntegrations(false)} />
      <ModelSettingsModal isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} sessionId={sessionId} />
      <AgentThreadList
        isOpen={showThreads}
        onClose={() => setShowThreads(false)}
        onOpenThread={(sid) => openThread(sid)}
        onDeleteThread={(sid) => deleteThread(sid)}
        currentSessionId={sessionId}
        refreshKey={threadsRefreshKey}
        workspaceId={activeWorkspaceId || undefined}
      />
    </div>
  );
};

export default AgentPanel;

// Extract a human-readable string from a UI message produced by @ai-sdk/react streams
function extractVisibleTextFromMessage(m: any): string {
  try {
    const parts = m?.parts;
    if (Array.isArray(parts)) {
      // Prefer explicit output text parts; fall back to plain text parts
      const collect = (types: string[]) => parts
        .filter((p: any) => types.includes(String(p?.type)) && typeof p?.text === "string")
        .map((p: any) => String(p.text))
        .join("");

      const outText = collect(["output_text", "output-text", "message", "text"]);
      if (outText && outText.trim().length > 0) return outText;

      // If assistant message has no user-visible text yet (e.g., only reasoning/step parts), render nothing
      if (m?.role === "assistant") return "";
    }
    if (typeof m?.content === "string") return m.content;
    // Avoid dumping raw JSON objects in the UI; keep empty string for unknown shapes
    return "";
  } catch {
    return "";
  }
}

function buildDynamicFromAttachments(pending: Map<string, AgentAttachment>) {
  const files = Array.from(pending.values()).map((v) => ({ path: v.path, lines: v.lines ?? null, tokenCount: v.tokenCount }));
  return { files };
}

function buildInitialSummaryMessage(envelope: any): string {
  try {
    const i = envelope?.initial;
    const ws = envelope?.workspace || "(unknown)";
    const files = Array.isArray(i?.files) ? i.files : [];
    const prompts = i?.prompts;
    const totalTokens = i?.metadata?.totalTokens ?? 0;
    const header = `Initial context from PasteFlow — Workspace: ${ws}`;
    const fList = files.slice(0, 20).map((f: any) => `- ${f.relativePath || f.path}${f?.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : ''}`).join("\n");
    const truncated = files.length > 20 ? `\n(…${files.length - 20} more)` : "";
    const promptSummary = `System=${prompts?.system?.length ?? 0}, Roles=${prompts?.roles?.length ?? 0}, Instructions=${prompts?.instructions?.length ?? 0}`;
    return [
      header,
      `Files: ${files.length} (est. tokens: ${totalTokens})`,
      fList || "(none)",
      truncated,
      `Prompts: ${promptSummary}`,
    ].filter(Boolean).join("\n");
  } catch {
    return "Initial context received.";
  }
}
