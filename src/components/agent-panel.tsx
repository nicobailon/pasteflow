import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import useAgentPanelResize from "../hooks/use-agent-panel-resize";
import AgentChatInputWithMention from "./agent-chat-input";
import AgentAttachmentList from "./agent-attachment-list";
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
  const [pinnedAttachments, setPinnedAttachments] = useState<Map<string, AgentAttachment>>(new Map());
  const [pinEnabled, setPinEnabled] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { messages, sendMessage, status, stop } = useChat({
    api: "/api/v1/chat",
    onFinish: () => {
      // Clear one-shot attachments and respect pin state
      setPendingAttachments(new Map());
      if (!pinEnabled) setPinnedAttachments(new Map());
    }
  } as any);

  // Local input state for composer (since useChat v2 doesn't expose input/setInput)
  const [composer, setComposer] = useState("");

  // Receive "Send to Agent" event from other parts of the UI
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text: string; meta?: Record<string, unknown> }>;
      if (!ce?.detail) return;
      sendMessage({ text: ce.detail.text, metadata: ce.detail.meta as any } as any);
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

      // Merge pending + pinned (dedupe by path)
      const byPath = new Map<string, AgentAttachment>([
        ...pinnedAttachments,
        ...pendingAttachments
      ]);
      const attachments = Array.from(byPath.values());

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
    [composer, pendingAttachments, pinnedAttachments, detectLanguage, ensureAttachmentContent, sendMessage]
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
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={pinEnabled}
              onChange={(e) => setPinEnabled(e.target.checked)}
            />
            Pin
          </label>
        </div>
      </div>

      <div className="agent-panel-body">
        <AgentAttachmentList
          pending={pendingAttachments}
          pinned={pinnedAttachments}
          pinEnabled={pinEnabled}
          onRemove={(absPath) => {
            setPendingAttachments((prev) => {
              const n = new Map(prev);
              n.delete(absPath);
              return n;
            });
            setPinnedAttachments((prev) => {
              const n = new Map(prev);
              n.delete(absPath);
              return n;
            });
          }}
          onPinToggle={(absPath, on) => {
            setPinnedAttachments((prev) => {
              const n = new Map(prev);
              if (on) {
                const item =
                  pendingAttachments.get(absPath) ||
                  prev.get(absPath) ||
                  ({ path: absPath, lines: null } as any);
                n.set(absPath, item as any);
              } else {
                n.delete(absPath);
              }
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
            <button className="primary" type="submit" disabled={status !== "ready" || !composer.trim()}>
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
