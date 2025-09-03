import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import useAgentPanelResize from "../hooks/use-agent-panel-resize";
import AgentChatInputWithMention from "./agent-chat-input";
import AgentAttachmentList from "./agent-attachment-list";
import AgentToolCalls from "./agent-tool-calls";
import type { FileData } from "../types/file-types";
import { extname } from "../file-ops/path";
import "./agent-panel.css";

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
    const apiBase = typeof info.apiBase === "string" ? info.apiBase : "http://127.0.0.1:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }

  // Initial context from Content Area hand-off
  const lastInitialRef = useRef<any | null>(null);
  const { apiBase, authToken } = useApiInfo();
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

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
        const headers: Record<string, string> = {
          ...(init?.headers as any),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        return fetch(url, { ...init, headers });
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
      setErrorStatus(null);
    },
    onError: (err: any) => {
      const code = typeof err?.status === "number" ? err.status : (typeof err?.code === "number" ? err.code : null);
      if (code === 429) setErrorStatus(429);
    }
  } as any);

  // Local input state for composer (since useChat v2 doesn't expose input/setInput)
  const [composer, setComposer] = useState("");

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

  // Ensure we have content for each attachment path (best-effort)
  const ensureAttachmentContent = useCallback(async (path: string): Promise<string> => {
    // Try from attachments first
    const fromPending = pendingAttachments.get(path)?.content;
    if (typeof fromPending === "string") return fromPending;

    // Try from allFiles (already loaded)
    const fd = allFiles.find((f) => f.path === path);
    if (fd && fd.isContentLoaded && typeof fd.content === "string") {
      return fd.content;
    }

    // Attempt to load via bridge if available
    if (loadFileContent) {
      try {
        await loadFileContent(path);
        // After load, try to find again (note: parent state updates asynchronously; this is best-effort)
        const fd2 = allFiles.find((f) => f.path === path);
        if (fd2 && fd2.isContentLoaded && typeof fd2.content === "string") {
          return fd2.content;
        }
      } catch {
        // ignore load errors here; fall through to placeholder
      }
    }

    // As a last resort, return empty string (will produce 0 lines and empty code fence)
    return "";
  }, [allFiles, loadFileContent, pendingAttachments]);

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
        <div className="agent-banner">{status === "streaming" || status === "submitted" ? "Streaming…" : "Ready"}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {status === "streaming" || status === "submitted" ? (
            <button onClick={() => stop()} title="Stop" aria-label="Stop generation">Stop</button>
          ) : (
            <button
              onClick={() => {
                setComposer("");
                setPendingAttachments(new Map());
              }}
              title="Clear"
              aria-label="Clear"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="agent-panel-body">
        {errorStatus === 429 && (
          <div role="alert" style={{ background: "#ffefef", color: "#a00", padding: 8, border: "1px solid #eaa", margin: "6px 8px", borderRadius: 4 }}>
            Rate limited (429). Please wait and try again.
            <button onClick={() => setErrorStatus(null)} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
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

              return (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{m.role}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{displayText}</div>
                  {/* Minimal tool-call visualization beneath assistant messages */}
                  {m?.role === "assistant" && <AgentToolCalls message={m} />}
                </div>
              );
            })
          )}
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
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", flex: 1 }}>{tokenHint}</div>
            <button
              className="primary"
              type="submit"
              disabled={(status === "streaming" || status === "submitted") || !composer.trim()}
            >
              Send
            </button>
          </div>
        </form>
      </div>

      <button
        className="agent-panel-resize-handle"
        onMouseDown={handleResizeStart}
        aria-label="Resize agent panel"
        title="Drag to resize agent panel"
      />
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
