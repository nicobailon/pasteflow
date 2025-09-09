import React from "react";

interface AgentDisabledOverlayProps {
  readonly onOpenWorkspaces: () => void;
  readonly onOpenFolder: () => void;
}

const AgentDisabledOverlay: React.FC<AgentDisabledOverlayProps> = ({ onOpenWorkspaces, onOpenFolder }) => {
  return (
    <div className="agent-panel-disabled-overlay" role="note">
      <div className="agent-disabled-title">No workspace open</div>
      <div className="agent-disabled-subtitle">Open a saved workspace or select a folder to create one.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={onOpenWorkspaces}>Open Workspace</button>
        <button className="secondary" onClick={onOpenFolder}>Open Folder</button>
      </div>
    </div>
  );
};

export default AgentDisabledOverlay;

