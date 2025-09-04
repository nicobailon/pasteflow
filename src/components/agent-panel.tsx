import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import useAgentPanelResize from "../hooks/use-agent-panel-resize";
import AgentChatInputWithMention from "./agent-chat-input";
import AgentAttachmentList from "./agent-attachment-list";
import AgentToolCalls from "./agent-tool-calls";
import IntegrationsModal from "./integrations-modal";
import ModelSelector from "./model-selector";
import { ArrowUp } from "lucide-react";
import ModelSettingsModal from "./model-settings-modal";
import { Settings as SettingsIcon } from "lucide-react";
import AgentAlertBanner from "./agent-alert-banner";
import type { FileData } from "../types/file-types";
import { extname } from "../file-ops/path";
import "./agent-panel.css";
import { requestFileContent } from "../handlers/electron-handlers";

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
const AgentPanel = ({ hidden, allFiles = [], selectedFolder = null, loadFileContent }: AgentPanelProps) => {
  const { agentWidth, handleResizeStart } = useAgentPanelResize(320);

  // Local attachment state (message-scoped)
  const [pendingAttachments, setPendingAttachments] = useState<Map<string, AgentAttachment>>(new Map());

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  const hadErrorRef = useRef(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState<boolean | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  // Start a durable session on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:start-session', {});
        const id = (res && typeof res === 'object' && 'success' in res) ? (res as any).data?.sessionId : res?.data?.sessionId;
        if (mounted && typeof id === 'string') setSessionId(id);
      } catch { /* noop */ }
    })();
    return () => { mounted = false; };
  }, []);

  const { messages, sendMessage, status, stop } = useChat({
    api: `${apiBase}/api/v1/chat`,
    headers: { Authorization: authToken ? `Bearer ${authToken}` : undefined },
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
        return fetch(url, { ...init, headers: merged });
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
    onFinish: () => {
      // Clear one-shot attachments
      setPendingAttachments(new Map());
      // Only clear error if there wasn't an error signaled in this turn
      if (!hadErrorRef.current) {
        setErrorStatus(null);
      }
      hadErrorRef.current = false;
    },
    onError: (err: any) => {
      const code = typeof err?.status === "number" ? err.status : (typeof err?.code === "number" ? err.code : null);
      hadErrorRef.current = true;
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

  // Receive "Send to Agent" event from other parts of the UI
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      if (!ce?.detail) return;
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
  }, [sendMessage]);

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

      // Send to LLM with full contents
      sendMessage({ text: llmText } as any);

      // Clear local composer
      setComposer("");
    },
    [composer, pendingAttachments, detectLanguage, ensureAttachmentContent, sendMessage]
  );

  const tokenHint = useMemo(() => {
    const total = (composer.length || 0) + Array.from(pendingAttachments.values()).reduce((acc, a) => acc + (a.tokenCount || 0), 0);
    return `${total} chars`;
  }, [composer, pendingAttachments]);

  if (hidden) return null;

  return (
    <div className="agent-panel" style={{ width: `${agentWidth}px` }} data-testid="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-title">Agent</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="secondary" onClick={() => setShowModelSettings(true)} title="Agent Settings" aria-label="Agent Settings">
            <SettingsIcon size={16} />
          </button>
          {status === "streaming" || status === "submitted" ? (
            <button className="cancel-button" onClick={interruptNow} title="Stop" aria-label="Stop generation">Stop</button>
          ) : ((hasOpenAIKey === false || errorStatus === 503) ? (
              <button className="primary" onClick={() => setShowIntegrations(true)} title="Configure AI Provider" aria-label="Configure AI Provider">Configure</button>
            ) : null)}
        </div>
      </div>

      <div className="agent-panel-body">
        {errorStatus === 503 && (
          <AgentAlertBanner
            variant="error"
            message="OpenAI API key is missing. Click Configure in the header to add it."
            onDismiss={() => setErrorStatus(null)}
          />
        )}
        {errorStatus === 429 && (
          <AgentAlertBanner
            variant="warning"
            message="Rate limited (429). Please wait a moment and try again."
            onDismiss={() => setErrorStatus(null)}
          />
        )}
        {errorStatus !== null && errorStatus !== 503 && errorStatus !== 429 && (
          <AgentAlertBanner
            variant="error"
            message={`Request failed (${errorStatus}). Please check logs or try again.`}
            onDismiss={() => setErrorStatus(null)}
          />
        )}
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
              // Extract plain text from message
              const rawText = (() => {
                const parts = m?.parts;
                if (Array.isArray(parts)) {
                  const text = parts
                    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
                    .map((p: any) => p.text)
                    .join("");
                  return text || JSON.stringify(m);
                }
                if (typeof m?.content === "string") return m.content;
                return JSON.stringify(m);
              })();

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
            disabled={status === "streaming" || status === "submitted"}
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
                <button
                  className="agent-input-submit"
                  type="submit"
                  title="Send"
                  aria-label="Send"
                  disabled={(status === "streaming" || status === "submitted") || !composer.trim()}
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
    </div>
  );
};

export default AgentPanel;

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
