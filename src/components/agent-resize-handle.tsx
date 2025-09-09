import React from "react";

interface AgentResizeHandleProps {
  readonly onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const AgentResizeHandle: React.FC<AgentResizeHandleProps> = ({ onMouseDown }) => (
  <button
    className="agent-panel-resize-handle"
    onMouseDown={onMouseDown}
    aria-label="Resize agent panel"
    title="Drag to resize agent panel"
  />
);

export default AgentResizeHandle;

