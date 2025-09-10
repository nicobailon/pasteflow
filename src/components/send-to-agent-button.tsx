import { memo, useCallback } from "react";
import type { SelectedFileReference, SystemPrompt, RolePrompt, Instruction } from "../types/file-types";
import { getRelativePath } from "../file-ops/path";

interface SendToAgentButtonProps {
  status: "idle" | "packing" | "ready" | "error" | "cancelled";
  selectedFolder: string | null;
  selectedFiles: SelectedFileReference[];
  selectedSystemPrompts: SystemPrompt[];
  selectedRolePrompts: RolePrompt[];
  selectedInstructions: Instruction[];
  userInstructions: string;
  tokenEstimate: number;
  signature: string;
  /** Full packed content (matches Copy to Clipboard) */
  fullContent?: string;
  /** Condensed content for display (matches Preview modal) */
  contentForDisplay?: string;
}

const SendToAgentButton = memo(function SendToAgentButton({
  status,
  selectedFolder,
  selectedFiles,
  selectedSystemPrompts,
  selectedRolePrompts,
  selectedInstructions,
  userInstructions,
  tokenEstimate,
  signature,
  fullContent,
  contentForDisplay,
}: SendToAgentButtonProps) {
  const handleClick = useCallback(() => {
    if (status !== "ready") return;
    const files = [] as Array<{ path: string; lines?: { start: number; end: number } | null; relativePath?: string }>;
    for (const sel of selectedFiles) {
      const rel = getRelativePath(sel.path, selectedFolder || "");
      if (sel.lines && Array.isArray(sel.lines) && sel.lines.length > 0) {
        for (const r of sel.lines) {
          files.push({ path: sel.path, lines: { start: r.start, end: r.end }, relativePath: rel });
        }
      } else {
        files.push({ path: sel.path, lines: null, relativePath: rel });
      }
    }

    const initial = {
      files,
      prompts: {
        system: (selectedSystemPrompts || []).map((p) => ({ id: p.id, name: p.name })),
        roles: (selectedRolePrompts || []).map((p) => ({ id: p.id, name: p.name })),
        instructions: (selectedInstructions || []).map((i) => ({ id: i.id, name: i.name })),
      },
      user: { present: Boolean(userInstructions && userInstructions.trim().length > 0), tokenCount: 0 },
      metadata: { totalTokens: tokenEstimate || 0, signature, timestamp: Date.now() },
    };

    const envelope = { version: 1 as const, initial, dynamic: { files: [] }, workspace: selectedFolder || null };
    const displayText = (contentForDisplay && typeof contentForDisplay === 'string') ? contentForDisplay : undefined;
    const fullText = (fullContent && typeof fullContent === 'string') ? fullContent : undefined;
    if (process.env.NODE_ENV === 'development') {
      try { console.log('[UI][send-to-agent:click]', { hasFull: Boolean(fullText), fullLen: fullText?.length || 0, displayLen: displayText?.length || 0 }); } catch { /* noop */ }
    }
    window.dispatchEvent(new CustomEvent("pasteflow:send-to-agent", { detail: { context: envelope, displayText, fullText } }));
  }, [status, selectedFiles, selectedSystemPrompts, selectedRolePrompts, selectedInstructions, userInstructions, tokenEstimate, signature, selectedFolder, fullContent, contentForDisplay]);

  return (
    <button
      className="primary copy-selected-files-btn"
      onClick={handleClick}
      disabled={status !== "ready"}
      title={status === "ready" ? "Send initial context to Agent" : "Pack not ready"}
      aria-label="Send to Agent"
    >
      <span>Send to Agent</span>
    </button>
  );
});

export default SendToAgentButton;
