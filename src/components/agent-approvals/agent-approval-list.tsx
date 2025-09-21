import type { ApprovalVm } from "../../hooks/use-agent-approvals";
import type { ApplyResult, ServiceResult, StoredApproval } from "../../main/agent/approvals-service";

import AgentApprovalEmptyState from "./agent-approval-empty-state";
import AutoApprovedTray from "./auto-approved-tray";
import ApprovalListCompact from "./approval-list-compact";
import "./agent-approvals.css";

export interface AgentApprovalListProps {
  readonly approvals: readonly ApprovalVm[];
  readonly bypassEnabled: boolean;
  readonly loading: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly autoApproved: readonly ApprovalVm[];
  readonly onApprove: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<ApplyResult>>;
  readonly onApproveWithEdits: (approvalId: string, content: Readonly<Record<string, unknown>>, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<ApplyResult>>;
  readonly onReject: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<StoredApproval>>;
  readonly onCancel: (previewId: string) => Promise<ServiceResult<null>>;
  readonly onToggleBypass: (enabled: boolean) => void;
}

const AgentApprovalList = ({
  approvals,
  bypassEnabled,
  loading,
  error,
  autoApproved,
  onApprove,
  onApproveWithEdits,
  onReject,
  onCancel,
  onToggleBypass,
}: AgentApprovalListProps) => {
  const count = approvals.length;

  let body: JSX.Element;
  if (loading) {
    body = <div className="agent-approval-list__status" aria-live="polite">Loading approvals…</div>;
  } else if (error) {
    body = <div className="agent-approval-list__status agent-approval-list__status--error" role="alert">{error.message}</div>;
  } else if (count === 0) {
    body = <AgentApprovalEmptyState bypassEnabled={bypassEnabled} onToggleBypass={onToggleBypass} />;
  } else {
    body = (
      <ApprovalListCompact
        approvals={approvals}
        onApprove={onApprove}
        onApproveWithEdits={onApproveWithEdits}
        onReject={onReject}
        onCancel={onCancel}
      />
    );
  }

  return (
    <section className="agent-approval-list" aria-label="Pending approvals">
      <header className="agent-approval-list__header">
        <h2>Pending approvals</h2>
        <span className="agent-approval-list__count">{count}</span>
      </header>
      {autoApproved.length > 0 ? <AutoApprovedTray autoApproved={autoApproved} /> : null}
      {body}
    </section>
  );
};

export default AgentApprovalList;
