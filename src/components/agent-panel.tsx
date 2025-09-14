import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, CircleStop } from "lucide-react";

import type { FileData } from "../types/file-types";
import { buildInitialSummaryMessage } from "../utils/agent-message-utils";
import { useAgentPanelResize } from "../hooks/use-agent-panel-resize";
import useAgentSession from "../hooks/use-agent-session";
import useAgentThreads from "../hooks/use-agent-threads";
import useAgentUsage from "../hooks/use-agent-usage";
import useSendToAgentBridge from "../hooks/use-send-to-agent-bridge";
import useAgentProviderStatus from "../hooks/use-agent-provider-status";

// Simplified input: no @-mention or attachment UI
import IntegrationsModal from "./integrations-modal";
import { ModelSelector } from "./model-selector";
import ModelSettingsModal from "./model-settings-modal";
import AgentThreadList from "./agent-thread-list";
import AgentPanelHeader from "./agent-panel-header";
import AgentNotifications from "./agent-notifications";
import AgentMessages from "./agent-messages";
import AgentDisabledOverlay from "./agent-disabled-overlay";
import AgentStatusBanner from "./agent-status-banner";
import AgentResizeHandle from "./agent-resize-handle";
import "./agent-panel.css";

// (types migrated to hooks/util files; keeping panel lean)

// IPC constants
const IPC_PREFS_GET = '/prefs/get';
const IPC_PREFS_SET = '/prefs/set';

// Module-scope helper to retrieve API info exposed by preload
function getApiInfo() {
  const info = window.__PF_API_INFO ?? {};
  const apiBase = typeof info.apiBase === "string" && info.apiBase ? info.apiBase : "http://localhost:5839";
  const authToken = typeof info.authToken === "string" ? info.authToken : "";
  return { apiBase, authToken };
}

// Helper functions to reduce cognitive complexity in onError
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const parseErrorDetails = (err: unknown) => {
  const statusVal = isObj(err) ? (err as { status?: unknown }).status : undefined;
  const codeVal = isObj(err) ? (err as { code?: unknown }).code : undefined;
  const code = typeof statusVal === 'number' ? statusVal : (typeof codeVal === 'number' ? codeVal : null);
  return { code };
};

const logErrorDetails = (err: unknown, code: number | null) => {
  try {
    const message = isObj(err) && typeof (err as { message?: unknown }).message === 'string' ? String((err as { message?: unknown }).message) : '';
    const codeStr = isObj(err) && typeof (err as { code?: unknown }).code === 'string' ? String((err as { code?: unknown }).code) : undefined;
    console.warn('[UI][chat:error]', { status: code, code: codeStr, message });
  } catch { /* noop */ }
};

const captureStructuredError = (err: unknown, code: number | null, setErrorInfo: (info: any) => void) => {
  try {
    const body = isObj(err) ? (err as { body?: unknown }).body : undefined;
    const payload = isObj(body) ? body : null;
    const e = isObj(payload) ? (payload as Record<string, unknown>)['error'] : null;
    
    if (code && isObj(e)) {
      setErrorInfo({ 
        status: code, 
        code: String((e as { code?: unknown }).code || ''), 
        message: String((e as { message?: unknown }).message || ''), 
        details: (e as { details?: unknown }).details 
      });
    } else if (code) {
      const msg = isObj(err) && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : undefined;
      const c = isObj(err) && typeof (err as { code?: unknown }).code === 'string' ? String((err as { code: string }).code) : undefined;
      setErrorInfo({ status: code, code: c, message: msg });
    }
  } catch { /* noop */ }
};

const isProviderConfigError = (err: unknown, code: number | null): boolean => {
  try {
    const name = isObj(err) && typeof (err as { name?: unknown }).name === 'string' ? (err as { name: string }).name : '';
    const msg = isObj(err) && typeof (err as { message?: unknown }).message === 'string' ? String((err as { message: string }).message).toLowerCase() : '';
    return name.includes("LoadAPIKeyError") || 
           msg.includes("api key is missing") || 
           msg.includes("api-key is missing") || 
           code === 401 || 
           code === 403;
  } catch {
    return false;
  }
};

const determineErrorStatus = (err: unknown, code: number | null, checkKeyPresence: () => Promise<boolean>): number => {
  if (code === 429) return 429;
  if (code === 503) return 503;
  
  if (isProviderConfigError(err, code)) return 503;
  
  // Fallback: if no stored key, surface Configure banner
  try {
    void (async () => {
      try {
        const hasKey = await checkKeyPresence();
        if (!hasKey) return 503;
      } catch { /* ignore */ }
    })();
  } catch { /* noop */ }

  if (typeof code === 'number' && code >= 400 && code <= 599) return code;
  return 500;
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
const AgentPanel = ({ hidden, allFiles: _allFiles = [], selectedFolder = null, currentWorkspace = null, loadFileContent: _loadFileContent }: AgentPanelProps) => {
  const { agentWidth, handleResizeStart } = useAgentPanelResize(320);

  // Attachments removed: panel no longer manages local file attachments

  // Track when a turn starts to compute renderer-side latency if server usage is missing
  const turnStartRef = useRef<number | null>(null);

  // Bridge provided by preload/IPC (fallback for tests/dev)

  // Initial context from Content Area hand-off
  const lastInitialRef = useRef<unknown | null>(null);
  const { apiBase, authToken } = getApiInfo();
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
  const [skipApprovals, setSkipApprovals] = useState<boolean>(false);
  const { hasOpenAIKey, checkKeyPresence } = useAgentProviderStatus();

  // Panel enabled only when a workspace is active and a folder is selected
  const panelEnabled = useMemo<boolean>(() => {
    return Boolean(currentWorkspace && selectedFolder);
  }, [currentWorkspace, selectedFolder]);

  const {
    sessionId,
    setSessionId,
    hydratedMessages,
    setHydratedMessages,
    isStartingChat,
    isSwitchingThread,
    setIsSwitchingThread,
    awaitingBind,
    setAwaitingBind,
    queuedFirstSend,
    setQueuedFirstSend,
    ensureSessionOrRetry,
  } = useAgentSession(panelEnabled);
  const [showThreads, setShowThreads] = useState(false);
  const statusRef = useRef<string | null>(null);

  // Note: workspace bootstrap handled by useAgentThreads

  // Workspace from the most recent send-to-agent context envelope
  const lastWorkspaceRef = useRef<string | null>(null);

  const { messages, sendMessage, status, stop } = useChat({
    api: `${apiBase}/api/v1/chat`,
    headers: { Authorization: authToken ? `Bearer ${authToken}` : undefined },
    id: sessionId || undefined,
    initialMessages: hydratedMessages,
    // Override fetch to ensure we always target the local API, include auth, and enforce full-text override
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const doFetch = async () => {
        if (process.env.NODE_ENV === 'development') {
          try {
            const dbg = { sessionId, method: (init?.method || (input instanceof Request ? input.method : 'POST')), ts: Date.now() };
            console.log('[UI][chat:request]', dbg);
          } catch { /* noop */ }
        }
        const info = window.__PF_API_INFO ?? {};
        const base = typeof info.apiBase === "string" ? info.apiBase : apiBase;
        const token = typeof info.authToken === "string" ? info.authToken : authToken;
        const url = `${base}/api/v1/chat`;
        // Merge headers
        const merged = new Headers(init?.headers as HeadersInit | undefined);
        if (token) merged.set('Authorization', `Bearer ${token}`);
        if (sessionId) merged.set('X-Pasteflow-Session', sessionId);

        // Materialize/modify JSON body robustly (handles both init.body and Request as input)
        let bodyStr: string | undefined;
        try {
          if (typeof init?.body === 'string') bodyStr = init.body as string;
          else if (input instanceof Request) {
            try { bodyStr = await input.clone().text(); } catch { /* noop */ }
          }
        } catch { /* noop */ }

        // no further body rewrites needed; tools remain enabled and are gated only by approvals/config

        const finalInit: RequestInit = { ...init, headers: merged };
        if (bodyStr !== undefined) finalInit.body = bodyStr;

        return fetch(url, finalInit).then(async (res) => {
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
            try { console.warn('[UI][chat:response:error]', { status: res.status, code: err.code, message: err.message }); } catch { /* noop */ }
            throw err;
          }
          try { console.log('[UI][chat:response:ok]', { status: res.status }); } catch { /* noop */ }
          return res;
        });
      };
      try { return doFetch(); } catch { return fetch(input, init); }
    },
    // Attach structured envelope without changing user text embeddings
    prepareSendMessagesRequest: ({ messages, requestBody }: { messages: readonly { role: string; content: readonly { readonly type?: string; readonly text?: string; readonly content?: unknown }[] | string }[]; requestBody: Record<string, unknown> }) => {
      const envelope = {
        version: 1 as const,
        initial: lastInitialRef.current || undefined,
        // dynamic files omitted by design (panel-local attachments removed)
        workspace: (selectedFolder ?? lastWorkspaceRef.current) || null,
      };
      try {
        const lastUser = (() => {
          try {
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m?.role === 'user') {
                const parts = Array.isArray(m.content) ? m.content : [];
                for (let j = parts.length - 1; j >= 0; j--) {
                const p = parts[j] as { type?: string; text?: string } | null | undefined;
                if (p && p.type === 'text' && typeof p.text === 'string') return p.text;
                }
              }
            }
            return '';
          } catch { return ''; }
        })();
        const t = String(lastUser || '').toLowerCase();
        if (/\bwhich\b.*\btools\b.*\b(avail|have)\b/.test(t) || /\bwhat\b.*\btools\b.*\b(avail|can you use|have)\b/.test(t)) {
          console.log('[UI][chat] tool-availability-query detected');
        }
        console.log('[UI][chat:prepare]', { sessionId, dynamicFiles: 0, hasInitial: !!lastInitialRef.current });
      } catch { /* noop */ }
      // Keep messages unchanged here and defer any full-text substitution to the fetch override.
      const base: Record<string, unknown> = { ...requestBody };
      base.messages = messages as unknown as readonly unknown[];
      base.context = envelope as unknown as Record<string, unknown>;
      if (sessionId) base.sessionId = sessionId;
      return base;
    },
    onFinish: async (finishInfo: unknown) => {
      try {
        if (sessionId) {
          try { console.log('[UI][chat:finish]', { sessionId }); } catch { /* noop */ }
          try { console.log('[UI][Telemetry] onFinish: snapshot + usage refresh start', { sessionId }); } catch { /* noop */ }
          const [p, m] = await Promise.all([
            window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_GET, { key: 'agent.provider' }) ?? Promise.resolve(null),
            window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_GET, { key: 'agent.defaultModel' }) ?? Promise.resolve(null),
          ]);
          type IpcResp<T = unknown> = { success: true; data: T } | { success: true; data: null } | { success: false; error?: string } | null;
          const provider = ((): string | undefined => {
            const r = p as IpcResp<unknown>;
            return (r && 'success' in (r as object) && (r as { success: boolean }).success === true && typeof (r as { data?: unknown }).data === 'string')
              ? (r as { data: string }).data : undefined;
          })();
          const model = ((): string | undefined => {
            const r = m as IpcResp<unknown>;
            return (r && 'success' in (r as object) && (r as { success: boolean }).success === true && typeof (r as { data?: unknown }).data === 'string')
              ? (r as { data: string }).data : undefined;
          })();
          // Retry snapshot persist a few times to tolerate DB readiness and preference races
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const wsId = await resolveWorkspaceId();
              const res: unknown = await window.electron?.ipcRenderer?.invoke?.('agent:threads:saveSnapshot', {
                sessionId,
                workspaceId: wsId || undefined,
                messages: (() => {
                  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
                  const get = (o: unknown, k: string): unknown => (isObj(o) ? (o as Record<string, unknown>)[k] : undefined);
                  const msgs = get(finishInfo, 'messages');
                  return Array.isArray(msgs) ? msgs : undefined;
                })(),
                meta: { model, provider },
              });
              if (res && typeof res === 'object' && 'success' in res && (res as { success: boolean }).success === false) {
                await new Promise((r) => setTimeout(r, 200));
                continue;
              }
              if (wsId) {
                try { await window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_SET, { key: `agent.lastSession.${wsId}`, value: sessionId }); } catch { /* ignore */ }
              }
              bumpThreadsRefreshKey();
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 200));
            }
          }

          // Renderer-side telemetry append (usage + latency)
          try {
            const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
            const get = (o: unknown, k: string): unknown => (isObj(o) ? (o as Record<string, unknown>)[k] : undefined);
            const usageRoot = get(finishInfo, 'usage') ?? get(get(finishInfo, 'data'), 'usage');
            const toNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
            const input = toNum(get(usageRoot, 'inputTokens'));
            const output = toNum(get(usageRoot, 'outputTokens'));
            const totalCandidate = toNum(get(usageRoot, 'totalTokens'));
            const total = (totalCandidate == null) ? ((input != null && output != null) ? input + output : null) : totalCandidate;
            const latency = (turnStartRef.current && typeof turnStartRef.current === 'number') ? (Date.now() - turnStartRef.current) : null;
            if (input != null || output != null || total != null || latency != null) {
              await window.electron?.ipcRenderer?.invoke?.('agent:usage:append', { sessionId, inputTokens: input, outputTokens: output, totalTokens: total, latencyMs: latency });
              try { console.log('[UI][Telemetry] renderer append usage', { sessionId, input, output, total, latency }); } catch { /* noop */ }
            } else {
              try { console.log('[UI][Telemetry] renderer append skipped (no usage payload)'); } catch { /* noop */ }
            }
          } catch (error) {
            try { console.warn('[UI][Telemetry] renderer append failed', error); } catch { /* noop */ }
          }
        }
      } catch { /* ignore */ }
      // No panel-local attachments to clear
      // Only clear error if there wasn't an error signaled in this turn
      if (!hadErrorRef.current) {
        setErrorStatus(null);
        setErrorInfo(null);
      }
      hadErrorRef.current = false;
      // Refresh usage immediately after finish
      try {
        await refreshUsage();
      } catch { /* ignore */ }
    },
    onError: (err: unknown) => {
      hadErrorRef.current = true;
      
      const { code } = parseErrorDetails(err);
      
      logErrorDetails(err, code);
      captureStructuredError(err, code, setErrorInfo);
      
      const status = determineErrorStatus(err, code, checkKeyPresence);
      setErrorStatus(status);
    }
  } as any);
  // Adapter to satisfy the UI's stricter payload type without relaxing library types
  const sendChat: (payload: { text: string }) => void = useCallback((payload) => {
    try {
      (sendMessage as unknown as (o: { text: string }) => void)(payload);
    } catch {
      // Best-effort fallback; in tests, the mock supports this shape
      (sendMessage as unknown as (o?: unknown) => void)({ text: payload.text });
    }
  }, [sendMessage]);

  statusRef.current = (status as string | null) ?? null;

  const {
    activeWorkspaceId,
    setActiveWorkspaceId,
    threadsRefreshKey,
    bumpThreadsRefreshKey,
    resolveWorkspaceId,
    openThread,
    deleteThread,
  } = useAgentThreads({ currentWorkspace, selectedFolder, sessionId, getStatus: () => statusRef.current, setSessionId, setHydratedMessages });

  const { usageRows, modelId, refreshUsage, sessionTotals } = useAgentUsage({ sessionId, status: status as string | null });

  // Usage list and provider/model handled by useAgentUsage

  // Load skip approvals preference
  useEffect(() => {
    (async () => {
      try {
        const res: unknown = await window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_GET, { key: 'agent.skipApprovals' });
        const saved = (res && typeof res === 'object' && 'success' in res && (res as { success: boolean }).success === true)
          ? (res as { data?: unknown }).data : null;
        setSkipApprovals(Boolean(saved));
      } catch { /* ignore */ }
    })();
  }, []);



  // Very rough cost hint (optional). Extend map as needed.


  // Estimate tokens for a message index (assistant + preceding user)

  // Aggregate session totals from persisted usage; fallback to estimate from messages when needed

  // Workspace bootstrapping handled by useAgentThreads

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
    try { setIsStopping(true); } catch { /* noop */ }
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
  // Guard against rapid stop clicks while cancellation propagates
  const [isStopping, setIsStopping] = useState(false);

  // Reset stop-guard when no longer streaming/submitted
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return;
    setIsStopping(false);
  }, [status]);

  // Global event to open Integrations modal from header/menu
  useEffect(() => {
    const handler = () => setShowIntegrations(true);
    window.addEventListener('pasteflow:open-integrations', handler as EventListener);
    return () => window.removeEventListener('pasteflow:open-integrations', handler as EventListener);
  }, []);

  // Clear provider-config error when key is present
  useEffect(() => {
    if (hasOpenAIKey) setErrorStatus(null);
  }, [hasOpenAIKey]);

  // Thread load failure notice listener (from useAgentThreads)
  useEffect(() => {
    const onLoadError = (e: Event) => {
      try {
        const ev = e as CustomEvent<{ sessionId: string; code?: string }>;
        const code = ev?.detail?.code;
        const msg = code === 'WORKSPACE_NOT_SELECTED'
          ? 'No active workspace selected. Open or load a workspace to view saved chats.'
          : (code === 'WORKSPACE_NOT_FOUND' ? 'Workspace not found for this chat.' : 'Could not load the selected chat.');
        const nId = `thread-load-failed-${Date.now()}`;
        setNotices((prev) => [...prev, { id: nId, variant: 'warning', message: msg }]);
        setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== nId)), 2500);
      } catch { /* noop */ }
    };
    window.addEventListener('agent-thread-load-error', onLoadError as unknown as EventListener);
    return () => window.removeEventListener('agent-thread-load-error', onLoadError as unknown as EventListener);
  }, []);

  // Transient banner helper for info/warning notices
  const showTransientNotice = useCallback((message: string, variant: 'warning' | 'info' = 'info', durationMs = 1800) => {
    const nId = `${variant}-notice-${Date.now()}`;
    setNotices((prev) => [...prev, { id: nId, variant, message }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== nId));
    }, durationMs);
  }, []);

  // Wire "Send to Agent" global event to chat
  useSendToAgentBridge({
    sessionId,
    ensureSessionOrRetry,
    sendMessage: (p) => sendChat(p),
    lastInitialRef,
    buildInitialSummaryMessage,
    // capture workspace from context for server-side tools gating
    setLastWorkspace: (ws) => { lastWorkspaceRef.current = ws; },
    awaitingBind,
    isSwitchingThread,
    setQueuedFirstSend,
    onQueuedNotice: (msg, ms) => showTransientNotice(msg, 'info', ms ?? 1800),
  });

  // Queue handling: if a send was queued during thread switching, flush it after binding
  useEffect(() => {
    if (!queuedFirstSend) return;
    if (awaitingBind || isSwitchingThread || !sessionId) return;
    // Flush the queued text now that session is ready
    sendChat({ text: queuedFirstSend });
    setQueuedFirstSend(null);
  }, [queuedFirstSend, awaitingBind, isSwitchingThread, sessionId, sendChat, setQueuedFirstSend]);

  // Detect code fence language based on file extension (moved to utils)

  // Condensation logic moved to utils and used by AgentMessages

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
          // Queue plain user text (no attachments in panel)
          setQueuedFirstSend(userText);
          setComposer("");
          return;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      try {
        const preview = composer.trim();
        console.log('[UI][chat:send]', { sessionId: sessionId || '(pending)', attachments: 0, text: preview.length > 160 ? preview.slice(0, 160) + '…' : preview });
      } catch { /* noop */ }
      // Send plain user text (mark turn start for latency)
      try { turnStartRef.current = Date.now(); } catch { /* noop */ }
      sendChat({ text: userText });

      // Clear local composer
      setComposer("");
    },
    [composer, sendChat, sessionId, ensureSessionOrRetry, setNotices, isStartingChat, isSwitchingThread, awaitingBind, setQueuedFirstSend]
  );

  // Token hint no longer aggregates attachments; omit for now

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
            window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_GET, { key: 'agent.provider' }) ?? Promise.resolve(null),
            window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_GET, { key: 'agent.defaultModel' }) ?? Promise.resolve(null),
          ]);
          const provider = (p && typeof p === 'object' && 'success' in p && (p as { success: boolean }).success === true && typeof (p as { data?: unknown }).data === 'string') ? (p as { data: string }).data : undefined;
          const model = (m && typeof m === 'object' && 'success' in m && (m as { success: boolean }).success === true && typeof (m as { data?: unknown }).data === 'string') ? (m as { data: string }).data : undefined;
          const wsId = await resolveWorkspaceId();
          await window.electron?.ipcRenderer?.invoke?.('agent:threads:saveSnapshot', {
            sessionId,
            workspaceId: wsId || undefined,
            messages,
            meta: { model, provider },
          });
          bumpThreadsRefreshKey();
        } catch { /* ignore snapshot of previous */ }
      }

      const res: unknown = await window.electron?.ipcRenderer?.invoke?.('agent:start-session', {});
      const __isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
      const ok = __isObj(res) && (res as Record<string, unknown>)['success'] === true;
      const dataVal = __isObj(res) ? (res as Record<string, unknown>)['data'] : undefined;
      const id = ok && __isObj(dataVal) && typeof (dataVal as { sessionId?: unknown }).sessionId === 'string'
        ? (dataVal as { sessionId: string }).sessionId
        : null;
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

  // Thread operations handled by useAgentThreads

  if (hidden) return null;

  return (
    <div className="agent-panel" style={{ width: `${agentWidth}px` }} data-testid="agent-panel">
      <AgentPanelHeader
        panelEnabled={panelEnabled}
        status={status as string | null}
        skipApprovals={skipApprovals}
        onToggleSkipApprovals={async (next) => {
          setSkipApprovals(next);
          try { await window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_SET, { key: 'agent.skipApprovals', value: next }); } catch { /* ignore */ }
        }}
        onOpenThreads={() => { void (async () => { const ws = await resolveWorkspaceId(); if (ws) setActiveWorkspaceId(ws); bumpThreadsRefreshKey(); setShowThreads(true); })(); }}
        onToggleTerminal={() => { try { window.dispatchEvent(new CustomEvent('pasteflow:toggle-terminal')); } catch { /* noop */ } }}
        onNewChat={() => { void handleNewChat(); }}
        onOpenSettings={() => setShowModelSettings(true)}
        onOpenIntegrations={() => setShowIntegrations(true)}
        showConfigure={(hasOpenAIKey === false || errorStatus === 503)}
        onStop={interruptNow}
        messagesCount={messages.length}
        sessionTotals={sessionTotals}
        modelId={modelId}
      />

      <div className="agent-panel-body">
        {/* Disabled overlay when no workspace is active */}
        {!panelEnabled && (
          <AgentDisabledOverlay
            onOpenWorkspaces={() => window.dispatchEvent(new CustomEvent('pasteflow:open-workspaces'))}
            onOpenFolder={() => { try { window.electron?.ipcRenderer?.send?.('open-folder'); } catch { /* noop */ } }}
          />
        )}

        {/* Error and notice banners with specific, user-friendly messages */}
        <AgentNotifications
          notices={notices}
          onDismissNotice={(id) => setNotices((prev) => prev.filter((x) => x.id !== id))}
          errorStatus={errorStatus}
          errorInfo={errorInfo}
          onDismissError={() => { setErrorStatus(null); setErrorInfo(null); }}
        />
        {/* Attachments and mini file list removed in simplified panel */}
        <AgentMessages
          messages={messages as unknown[]}
          interruptions={interruptions}
          usageRows={usageRows}
          sessionId={sessionId}
          skipApprovals={skipApprovals}
          onToggleSkipApprovals={async (v) => {
            setSkipApprovals(Boolean(v));
            try { await window.electron?.ipcRenderer?.invoke?.(IPC_PREFS_SET, { key: 'agent.skipApprovals', value: Boolean(v) }); } catch { /* ignore */ }
          }}
          modelId={modelId}
        />
        <AgentStatusBanner status={status as string | null} />

        <form className="agent-input-container" onSubmit={handleSubmit}>
          <div className="autocomplete-container" style={{ position: "relative" }}>
            <textarea
              className="agent-input"
              placeholder="Message the Agent…"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              disabled={(!panelEnabled) || status === "streaming" || status === "submitted" || isStartingChat || isSwitchingThread}
            />
            <div className="agent-input-overlay">
              {(isStartingChat || isSwitchingThread) && (
                <div className="agent-starting-chip" aria-live="polite" aria-atomic="true">
                  <div className="agent-spinner" />
                  <span>Starting chat…</span>
                </div>
              )}
              {status === "streaming" || status === "submitted" ? (
                <button
                  className="agent-input-submit"
                  type="button"
                  title="Stop"
                  aria-label="Stop"
                  onClick={() => { setIsStopping(true); interruptNow(); }}
                  disabled={(!panelEnabled) || isStartingChat || isSwitchingThread || isStopping}
                >
                  <CircleStop size={14} />
                </button>
              ) : (
                <button
                  className="agent-input-submit"
                  type="submit"
                  title="Send"
                  aria-label="Send"
                  disabled={(!panelEnabled) || isStartingChat || isSwitchingThread || !composer.trim()}
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="agent-input-underbar">
            <ModelSelector onOpenSettings={() => setShowModelSettings(true)} />
          </div>
        </form>
      </div>

      <AgentResizeHandle onMouseDown={handleResizeStart} />

      <IntegrationsModal isOpen={showIntegrations} onClose={() => setShowIntegrations(false)} />
      <ModelSettingsModal isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} sessionId={sessionId} workspaceId={activeWorkspaceId || null} />
      <AgentThreadList
        isOpen={showThreads}
        onClose={() => setShowThreads(false)}
        onOpenThread={(sid) => { void openThread(sid); setShowThreads(false); }}
        onDeleteThread={(sid) => deleteThread(sid)}
        currentSessionId={sessionId}
        refreshKey={threadsRefreshKey}
        workspaceId={activeWorkspaceId || undefined}
      />
    </div>
  );
};

export default AgentPanel;
// utils moved to ../utils/agent-message-utils
