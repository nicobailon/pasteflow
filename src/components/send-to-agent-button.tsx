import { memo, useCallback } from "react";

interface PackedForAgent {
  content: string;
  tokenEstimate?: number;
  files?: number;
}

export const SendToAgentButton = memo(function SendToAgentButton({ enabled, packed }: { enabled: boolean; packed: PackedForAgent }) {
  const handleClick = useCallback(() => {
    const detail = {
      content: packed.content,
      metadata: { tokens: packed.tokenEstimate || 0, files: packed.files || 0 },
    };
    window.dispatchEvent(new CustomEvent("pasteflow:send-to-agent", { detail }));
  }, [packed]);

  return (
    <button
      className="preview-button"
      onClick={handleClick}
      disabled={!enabled}
      title={enabled ? "Send packed content to Agent" : "Pack content first"}
      aria-label="Send to Agent"
      type="button"
    >
      <span>Send to Agent</span>
    </button>
  );
});

export default SendToAgentButton;

