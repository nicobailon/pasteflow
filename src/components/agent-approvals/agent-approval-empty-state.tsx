interface AgentApprovalEmptyStateProps {
  readonly bypassEnabled: boolean;
  readonly onToggleBypass?: (enabled: boolean) => void;
}

const AgentApprovalEmptyState = ({ bypassEnabled, onToggleBypass }: AgentApprovalEmptyStateProps) => (
  <div className="agent-approval-empty" role="status" aria-live="polite">
    <p className="agent-approval-empty__message">No approvals waiting.</p>
    {onToggleBypass ? (
      <button
        type="button"
        className="agent-approval-empty__toggle"
        onClick={() => onToggleBypass(!bypassEnabled)}
      >
        {bypassEnabled ? "Disable bypass" : "Enable bypass"}
      </button>
    ) : null}
  </div>
);

export default AgentApprovalEmptyState;
