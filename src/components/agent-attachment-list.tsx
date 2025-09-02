import { memo } from "react";
import { basename } from "../file-ops/path";

export type AgentAttachment = {
  path: string;
  content?: string;
  tokenCount?: number;
  lines?: { start: number; end: number } | null;
};

interface AgentAttachmentListProps {
  pending: Map<string, AgentAttachment>;
  pinned: Map<string, AgentAttachment>;
  pinEnabled: boolean;
  onRemove: (absPath: string) => void;
  onPinToggle: (absPath: string, on: boolean) => void;
}

/**
 * AgentAttachmentList
 * - Renders a compact list of pending/pinned attachments for the Agent Panel
 * - Does not mutate global selection or tree state
 * - Uses existing .file-card styles for visual consistency
 */
const AgentAttachmentList = memo(function AgentAttachmentList({
  pending,
  pinned,
  pinEnabled,
  onRemove,
  onPinToggle,
}: AgentAttachmentListProps) {
  const items: AgentAttachment[] = [
    ...Array.from(pinned.values()),
    ...Array.from(pending.values()).filter((p) => !pinned.has(p.path)),
  ];

  if (items.length === 0) {
    return null;
  }

  return (
    <div style={{ padding: "0.25rem 0.5rem", borderBottom: "1px solid var(--border-color)" }} aria-label="Agent context files">
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
        Context files {pinEnabled ? "(pin on)" : ""}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((att) => {
          const isPinned = pinned.has(att.path);
          return (
            <div key={att.path} className="file-card" title={att.path} style={{ padding: "2px 6px" }}>
              <div className="file-card-header">
                <div className="file-card-name">{basename(att.path)}</div>
                {typeof att.tokenCount === "number" && (
                  <div className="file-card-tokens" style={{ marginLeft: 6 }}>{att.tokenCount}t</div>
                )}
                {att.lines && (
                  <div className="file-card-line-badge">
                    {att.lines.start}-{att.lines.end}
                  </div>
                )}
              </div>
              <div className="file-card-actions" style={{ position: "static", background: "transparent", opacity: 1, gap: 4, paddingRight: 0 }}>
                <button
                  type="button"
                  className="file-card-action"
                  onClick={() => onPinToggle(att.path, !isPinned)}
                  title={isPinned ? "Unpin from thread" : "Pin to thread"}
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                <button
                  type="button"
                  className="file-card-action"
                  onClick={() => onRemove(att.path)}
                  title="Remove from pending"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default AgentAttachmentList;