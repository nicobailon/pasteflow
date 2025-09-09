import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { ArrowUp } from "lucide-react";


import useAgentPanelResize from "../hooks/use-agent-panel-resize";
import type { FileData } from "../types/file-types";

import AgentChatInputWithMention from "./agent-chat-input";
import AgentAttachmentList from "./agent-attachment-list";
import AgentMiniFileList from "./agent-mini-file-list";
import IntegrationsModal from "./integrations-modal";
import ModelSelector from "./model-selector";
import ModelSettingsModal from "./model-settings-modal";

import "./agent-panel.css";

import AgentThreadList from "./agent-thread-list";
import AgentPanelHeader from "./agent-panel-header";
import AgentNotifications from "./agent-notifications";
import AgentMessages from "./agent-messages";
import AgentDisabledOverlay from "./agent-disabled-overlay";
import AgentStatusBanner from "./agent-status-banner";
import AgentResizeHandle from "./agent-resize-handle";
import { buildDynamicFromAttachments, buildInitialSummaryMessage, detectLanguageFromPath } from "../utils/agent-message-utils";
import useAgentSession from "../hooks/use-agent-session";
import useAgentThreads from "../hooks/use-agent-threads";
import useAgentUsage from "../hooks/use-agent-usage";
import useSendToAgentBridge from "../hooks/use-send-to-agent-bridge";
import useAgentProviderStatus from "../hooks/use-agent-provider-status";
import useAttachmentContentLoader from "../hooks/use-attachment-content-loader";
import type { AgentAttachment } from "../types/agent-types";

// (types migrated to hooks/util files; keeping panel lean)

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

  const { messages, sendMessage, status, stop } = useChat({
    api: `${apiBase}/api/v1/chat`,
    headers: { Authorization: authToken ? `Bearer ${authToken}` : undefined },
    id: sessionId || undefined,
    initialMessages: hydratedMessages,
    // Override fetch to ensure we always target the local API and include auth
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const dbg = { sessionId, method: (init?.method || 'POST'), ts: Date.now() };
        console.log('[UI][chat:request]', dbg);
      } catch { /* noop */ }
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
            try { console.warn('[UI][chat:response:error]', { status: res.status, code: err.code, message: err.message }); } catch { /* noop */ }
            throw err;
          }
          try { console.log('[UI][chat:response:ok]', { status: res.status }); } catch { /* noop */ }
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
      try {
        const lastUser = (() => {
          try {
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m?.role === 'user') {
                const parts = Array.isArray(m.content) ? m.content : [];
                for (let j = parts.length - 1; j >= 0; j--) {
                  const p = parts[j] as any;
                  if (p && p.type === 'text' && typeof p.text === 'string') return p.text as string;
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
        console.log('[UI][chat:prepare]', { sessionId, dynamicFiles: dynamic.files?.length || 0, hasInitial: !!lastInitialRef.current });
      } catch { /* noop */ }
      return { ...requestBody, messages, context: envelope };
    },
    onFinish: async (finishInfo: any) => {
      try {
        if (sessionId) {
          try { console.log('[UI][chat:finish]', { sessionId }); } catch { /* noop */ }
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
              bumpThreadsRefreshKey();
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
          } catch (error) {
            try { console.warn('[UI][Telemetry] renderer append failed', error); } catch { /* noop */ }
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
        await refreshUsage();
      } catch { /* ignore */ }
    },
    onError: (err: any) => {
      const code = typeof err?.status === "number" ? err.status : (typeof err?.code === "number" ? err.code : null);
      hadErrorRef.current = true;
      try { console.warn('[UI][chat:error]', { status: code, code: (typeof err?.code === 'string' ? err.code : undefined), message: String(err?.message || '') }); } catch { /* noop */ }
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
            const hasKey = await checkKeyPresence();
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

  const { usageRows, lastUsage, provider, modelId, refreshUsage, sessionTotals } = useAgentUsage({ sessionId, status: status as string | null });

  // Usage list and provider/model handled by useAgentUsage

  // Load skip approvals preference
  useEffect(() => {
    (async () => {
      try {
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.skipApprovals' });
        const saved = res && res.success ? res.data : null;
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

  // Wire "Send to Agent" global event to chat
  useSendToAgentBridge({ sessionId, ensureSessionOrRetry, sendMessage: (p) => sendMessage(p as any), lastInitialRef, buildInitialSummaryMessage });

  // Queue handling: if a send was queued during thread switching, flush it after binding
  useEffect(() => {
    if (!queuedFirstSend) return;
    if (awaitingBind || isSwitchingThread || !sessionId) return;
    // Flush the queued text now that session is ready
    sendMessage({ text: queuedFirstSend } as any);
    setQueuedFirstSend(null);
  }, [queuedFirstSend, awaitingBind, isSwitchingThread, sessionId, sendMessage]);

  // Detect code fence language based on file extension (moved to utils)

  // Condensation logic moved to utils and used by AgentMessages

  // Ensure we have content for a given attachment path
  const { ensureAttachmentContent } = useAttachmentContentLoader({ allFiles, pendingAttachments, setPendingAttachments, loadFileContent });

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
          const attachments = [...pendingAttachments.values()];
          const llmBlocks: string[] = [];
          for (const att of attachments) {
            const content = typeof att.content === "string" && att.content.length > 0 ? att.content : await ensureAttachmentContent(att.path);
            const lang = detectLanguageFromPath(att.path);
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
      const attachments = [...pendingAttachments.values()];
      try {
        const preview = composer.trim();
        console.log('[UI][chat:send]', { sessionId: sessionId || '(pending)', attachments: attachments.length, text: preview.length > 160 ? preview.slice(0, 160) + '…' : preview });
      } catch { /* noop */ }

      // Prepare LLM payload blocks and UI condensed blocks
      const llmBlocks: string[] = [];
      const uiBlocks: string[] = [];

      for (const att of attachments) {
        const content = typeof att.content === "string" && att.content.length > 0
          ? att.content
          : await ensureAttachmentContent(att.path);

        const lang = detectLanguageFromPath(att.path);
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
    [composer, pendingAttachments, detectLanguageFromPath, ensureAttachmentContent, sendMessage, sessionId, ensureSessionOrRetry, setNotices, isStartingChat, isSwitchingThread]
  );

  const tokenHint = useMemo(() => {
    const total = (composer.length || 0) + [...pendingAttachments.values()].reduce((acc, a) => acc + (a.tokenCount || 0), 0);
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
          bumpThreadsRefreshKey();
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
          try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.skipApprovals', value: next }); } catch { /* ignore */ }
        }}
        onOpenThreads={() => { void (async () => { const ws = await resolveWorkspaceId(); if (ws) setActiveWorkspaceId(ws); bumpThreadsRefreshKey(); setShowThreads(true); })(); }}
        onToggleTerminal={() => { try { window.dispatchEvent(new CustomEvent('pasteflow:toggle-terminal')); } catch { /* noop */ } }}
        onNewChat={handleNewChat}
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
            onOpenFolder={() => { try { window.electron?.ipcRenderer?.send('open-folder'); } catch { /* noop */ } }}
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
        {/* Mini file list for quick context selection */}
        <AgentMiniFileList
          files={allFiles}
          selected={[...pendingAttachments.keys()]}
          onToggle={(absPath) => {
            setPendingAttachments((prev) => {
              const next = new Map(prev);
              if (next.has(absPath)) next.delete(absPath); else next.set(absPath, { path: absPath, lines: null });
              return next;
            });
          }}
          onTokenCount={(absPath, tokens) => {
            setPendingAttachments((prev) => {
              const next = new Map(prev);
              const cur = next.get(absPath);
              if (cur) next.set(absPath, { ...cur, tokenCount: tokens });
              return next;
            });
          }}
          collapsed={true}
        />
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
        <AgentMessages
          messages={messages as unknown[]}
          interruptions={interruptions}
          usageRows={usageRows}
          sessionId={sessionId}
          skipApprovals={skipApprovals}
          onToggleSkipApprovals={async (v) => {
            setSkipApprovals(Boolean(v));
            try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.skipApprovals', value: Boolean(v) }); } catch { /* ignore */ }
          }}
          modelId={modelId}
        />
        <AgentStatusBanner status={status as string | null} />

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

      <AgentResizeHandle onMouseDown={handleResizeStart} />

      <IntegrationsModal isOpen={showIntegrations} onClose={() => setShowIntegrations(false)} />
      <ModelSettingsModal isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} sessionId={sessionId} />
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
