import { useEffect, useMemo, useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";

import { ChatInputWithMention } from "./agent-chat-input";
import type { FileData } from "../types/file-types";
import { AgentSettingsModal } from "./agent-settings-modal";

type FileContext = {
  path?: string;
  content?: string;
  tokenCount?: number;
  lines?: { start: number; end: number }[] | null;
};

type PackedContent = {
  content: string;
  metadata?: { tokens?: number; files?: number };
};

export function AgentPanel({ className, allFiles, selectedFolder }: { className?: string; allFiles?: FileData[]; selectedFolder?: string | null }) {
  const [dynamicContext, setDynamicContext] = useState<Map<string, FileContext>>(new Map());
  const [initialTokens, setInitialTokens] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { messages, sendMessage, status, append } = useChat({
    api: "/api/v1/chat",
    onBeforeSend: (message: any) => {
      return {
        ...message,
        context: Array.from(dynamicContext.values()),
      };
    },
  } as any);

  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<PackedContent>;
      const packed = ce.detail;
      if (!packed) return;

      const text = formatPackedContent(packed);
      append({
        role: "user",
        content: text,
        metadata: {
          type: "packed-context",
          tokens: packed.metadata?.tokens ?? 0,
          files: packed.metadata?.files ?? 0,
        },
      } as any);
      setInitialTokens(packed.metadata?.tokens ?? 0);
    };
    window.addEventListener("pasteflow:send-to-agent", handler as any);
    return () => window.removeEventListener("pasteflow:send-to-agent", handler as any);
  }, [append]);

  const handleFileMention = useCallback(async (path: string, _lines?: { start: number; end: number }[]) => {
    setDynamicContext((prev) => new Map(prev).set(path, { path }));
  }, []);

  const tokenDisplay = useMemo(() => {
    const dyn = Array.from(dynamicContext.values()).reduce((acc, v) => acc + (v.tokenCount || 0), 0);
    return { initial: initialTokens, dynamic: dyn };
  }, [dynamicContext, initialTokens]);

  return (
    <div className={`agent-panel left-dock ${className || ''}`.trim()}>
      <div className="agent-header" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong>Agent</strong>
          <span style={{ color: "#6b7280", fontSize: 12 }}>
            ~{tokenDisplay.initial + tokenDisplay.dynamic} tokens
          </span>
        </div>
        <div>
          <button type="button" onClick={() => setSettingsOpen(true)} className="preview-button" title="Agent settings">
            Settings
          </button>
        </div>
      </div>
      <div className="agent-chat-area" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="agent-messages" style={{ maxHeight: 220, overflow: "auto", border: "1px solid #e5e7eb", padding: 8, borderRadius: 6 }}>
          {messages.map((m: any, idx: number) => (
            <div key={idx} style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{m.role}:</span> {String(m.content)}
            </div>
          ))}
          {messages.length === 0 && (
            <div style={{ color: "#9ca3af" }}>Start a conversation by typing below…</div>
          )}
        </div>

        <ChatInputWithMention
          onSend={(text) => sendMessage(text)}
          onFileMention={handleFileMention}
          disabled={status !== "ready"}
          allFiles={allFiles || []}
          selectedFolder={selectedFolder || null}
        />
      </div>
      <AgentSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function formatPackedContent(packed: PackedContent): string {
  const tokens = packed.metadata?.tokens ? `\n\n(~${packed.metadata.tokens} tokens)` : "";
  return `Context from PasteFlow:\n\n${packed.content}${tokens}`;
}

export default AgentPanel;
