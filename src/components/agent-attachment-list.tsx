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
  onRemove: (absPath: string) => void;
}

/**
 * AgentAttachmentList
 * - Renders a compact list of pending attachments for the Agent Panel
 * - Does not mutate global selection or tree state
 * - Uses existing .file-card styles for visual consistency
 */
const AgentAttachmentList = memo(function AgentAttachmentList({
  pending,
  onRemove,
}: AgentAttachmentListProps) {
  const items: AgentAttachment[] = Array.from(pending.values());

  if (items.length === 0) {
    return null;
  }

  return (
    <div style={{ padding: "0.25rem 0.5rem", borderBottom: "1px solid var(--border-color)" }} aria-label="Agent context files">
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Context files</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((att) => {
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
