import { useMemo, useState } from "react";

import type { ApprovalVm } from "../../hooks/use-agent-approvals";
import { getApprovalButtons } from "./button-config";

interface AgentApprovalCardProps {
  readonly approval: ApprovalVm;
  readonly bypassEnabled: boolean;
  readonly onApprove: () => void;
  readonly onApproveWithEdits?: () => void;
  readonly onReject: (options: { readonly feedbackText?: string; readonly feedbackMeta?: Record<string, unknown> | null }) => void;
  readonly onCancel?: () => void;
}

function formatTimestamp(value: number): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function extractPrimaryPath(detail: Readonly<Record<string, unknown>> | null): string | null {
  if (!detail) return null;
  const pathLike = detail.path ?? detail.file ?? detail.targetPath ?? detail.destination;
  return typeof pathLike === "string" ? pathLike : null;
}

const AgentApprovalCard = ({
  approval,
  bypassEnabled,
  onApprove,
  onApproveWithEdits,
  onReject,
  onCancel,
}: AgentApprovalCardProps) => {
  const [feedback, setFeedback] = useState<string>("");

  const jsonDetail = useMemo(() => {
    try {
      return approval.detail ? JSON.stringify(approval.detail, null, 2) : "";
    } catch {
      return "";
    }
  }, [approval.detail]);

  const primaryPath = useMemo(() => extractPrimaryPath(approval.detail), [approval.detail]);
  const timestamp = useMemo(() => formatTimestamp(approval.createdAt), [approval.createdAt]);

  const buttons = useMemo(() => getApprovalButtons({
    approval,
    streaming: approval.streaming,
    bypassEnabled,
    onApprove,
    onApproveWithEdits,
    onReject: () => {
      const trimmed = feedback.trim();
      onReject({ feedbackText: trimmed.length > 0 ? trimmed : undefined, feedbackMeta: null });
    },
    onCancel,
  }), [approval, approval.streaming, bypassEnabled, onApprove, onApproveWithEdits, onReject, onCancel, feedback]);

  return (
    <article className="agent-approval-card" aria-label={`Approval request for ${approval.summary}`}>
      <header className="agent-approval-card__header">
        <div className="agent-approval-card__title" aria-label="Tool and action">
          <span className="agent-approval-card__tool">{approval.tool}</span>
          <span className="agent-approval-card__action">{approval.action}</span>
        </div>
        <div className="agent-approval-card__meta">
          {primaryPath ? <span className="agent-approval-card__path" title={primaryPath}>{primaryPath}</span> : null}
          {timestamp ? <time className="agent-approval-card__time" dateTime={new Date(approval.createdAt).toISOString()}>{timestamp}</time> : null}
        </div>
      </header>
      <div className="agent-approval-card__body">
        <p className="agent-approval-card__summary">{approval.summary}</p>
        {approval.autoReason ? (
          <div className="agent-approval-card__badge" aria-label="Auto approval reason">Auto rule: {approval.autoReason}</div>
        ) : null}
        {jsonDetail ? (
          <pre className="agent-approval-card__detail" aria-label="Preview details">{jsonDetail}</pre>
        ) : null}
      </div>
      <footer className="agent-approval-card__footer">
        <label className="agent-approval-card__feedback" htmlFor={`approval-feedback-${approval.id}`}>
          <span className="agent-approval-card__feedback-label">Feedback (optional)</span>
          <textarea
            id={`approval-feedback-${approval.id}`}
            value={feedback}
            onChange={(event) => setFeedback(event.currentTarget.value)}
            rows={3}
            placeholder="Reason for approval or rejection"
          />
        </label>
        <div className="agent-approval-card__buttons">
          {buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              className={`agent-approval-card__button agent-approval-card__button--${button.kind}`}
              onClick={button.onSelect}
              disabled={button.disabled}
            >
              {button.label}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
};

export default AgentApprovalCard;
