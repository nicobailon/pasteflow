import { useCallback, useMemo, useState } from "react";

import type { ApprovalVm } from "../../hooks/use-agent-approvals";
import type { ApplyResult, ServiceResult, StoredApproval } from "../../main/agent/approvals-service";

import AgentApprovalCard from "./agent-approval-card";
import AgentApprovalEmptyState from "./agent-approval-empty-state";
import "./agent-approvals.css";

export interface AgentApprovalListProps {
  readonly approvals: readonly ApprovalVm[];
  readonly bypassEnabled: boolean;
  readonly loading: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly onApprove: (approvalId: string) => Promise<ServiceResult<ApplyResult>>;
  readonly onReject: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<StoredApproval>>;
  readonly onCancel: (previewId: string) => Promise<ServiceResult<null>>;
}

const AgentApprovalList = ({
  approvals,
  bypassEnabled,
  loading,
  error,
  onApprove,
  onReject,
  onCancel,
}: AgentApprovalListProps) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const handleApprove = useCallback(async (approvalId: string) => {
    setBusyId(approvalId);
    try {
      const result = await onApprove(approvalId);
      if (result.ok) {
        setLastMessage(null);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
      setBusyId(null);
    }
  }, [onApprove]);

  const handleReject = useCallback(async (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => {
    setBusyId(approvalId);
    try {
      const result = await onReject(approvalId, options);
      if (result.ok) {
        setLastMessage(null);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
    setBusyId((prev) => {
      if (prev === approvalId) return null;
      return prev;
    });
    }
  }, [onReject]);

  const handleCancel = useCallback(async (previewId: string) => {
    setBusyId(previewId);
    try {
      const result = await onCancel(previewId);
      if (result.ok) {
        setLastMessage(null);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
    setBusyId((prev) => {
      if (prev === previewId) return null;
      return prev;
    });
    }
  }, [onCancel]);

  const sortedApprovals = useMemo(() => {
    const list = [...approvals];
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [approvals]);

  let body: JSX.Element;
  if (loading) {
    body = <div className="agent-approval-list__status" aria-live="polite">Loading approvals…</div>;
  } else if (error) {
    body = <div className="agent-approval-list__status agent-approval-list__status--error" role="alert">{error.message}</div>;
  } else if (sortedApprovals.length === 0) {
    body = <AgentApprovalEmptyState bypassEnabled={bypassEnabled} onToggleBypass={undefined} />;
  } else {
    body = (
      <div className="agent-approval-list__items">
        {sortedApprovals.map((approval) => {
          const streaming = approval.streaming;
          const cancelHandler = (streaming === "pending" || streaming === "running")
            ? () => handleCancel(approval.previewId as string)
            : undefined;
          return (
            <AgentApprovalCard
              key={approval.id}
              approval={approval}
              bypassEnabled={bypassEnabled}
              onApprove={() => handleApprove(approval.id)}
              onReject={(options) => handleReject(approval.id, options)}
              onCancel={cancelHandler}
            />
          );
        })}
      </div>
    );
  }

  const infoMessage = lastMessage ? (
    <div className="agent-approval-list__status agent-approval-list__status--info" role="status">{lastMessage}</div>
  ) : null;

  const busyNotice = busyId ? (
    <div className="agent-approval-list__busy" aria-live="assertive">Processing…</div>
  ) : null;

  return (
    <section className="agent-approval-list" aria-label="Pending approvals">
      <header className="agent-approval-list__header">
        <h2>Pending approvals</h2>
        <span className="agent-approval-list__count">{sortedApprovals.length}</span>
      </header>
      {body}
      {infoMessage}
      {busyNotice}
    </section>
  );
};

export default AgentApprovalList;
