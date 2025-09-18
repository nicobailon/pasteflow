import { useCallback, useMemo, useState } from "react";

import type { ApprovalVm, StreamingState } from "../../hooks/use-agent-approvals";
import { getApprovalButtons } from "./button-config";
import DiffPreview from "./diff-preview";
import JsonPreview from "./json-preview";
import TerminalOutputView from "./terminal-output-view";
import EditApprovalModal from "./edit-approval-modal";
import { isPlainRecord } from "../../utils/approvals-parsers";

interface FeedbackOptions {
  readonly feedbackText?: string;
  readonly feedbackMeta?: Record<string, unknown> | null;
}

interface AgentApprovalCardProps {
  readonly approval: ApprovalVm;
  readonly onApprove: (options: FeedbackOptions) => void;
  readonly onApproveWithEdits?: (content: Readonly<Record<string, unknown>>, options: FeedbackOptions) => void;
  readonly onReject: (options: FeedbackOptions) => void;
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

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const coerced = Number(value);
    if (Number.isFinite(coerced)) return coerced;
  }
  return null;
}

function readTokenCounts(value: unknown): Readonly<{ original?: number; modified?: number }> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const original = readNumber(record.original);
  const modified = readNumber(record.modified);
  if (original == null && modified == null) return null;
  const payload: { original?: number; modified?: number } = {};
  if (original != null) payload.original = original;
  if (modified != null) payload.modified = modified;
  return Object.freeze(payload);
}

function extractDiffPreview(detail: Readonly<Record<string, unknown>> | null) {
  if (!detail) return null;
  const diff = readString(detail.diff ?? detail.patch ?? detail.delta);
  const original = readString(detail.original);
  const modified = readString(detail.modified);
  const tokenCounts = readTokenCounts(detail.tokenCounts ?? null);
  const existed = typeof detail.existed === "boolean" ? detail.existed : null;
  const applied = typeof detail.applied === "boolean" ? detail.applied : null;
  const error = readString(detail.error ?? detail.reason);
  const bytes = readNumber(detail.bytes);
  if (!diff && !original && !modified && !tokenCounts && existed == null && applied == null && error == null) {
    return null;
  }
  return Object.freeze({
    diff,
    original,
    modified,
    tokenCounts,
    existed,
    applied,
    error,
    bytes,
  });
}

function extractTerminalPreview(detail: Readonly<Record<string, unknown>> | null) {
  if (!detail) return null;
  const sessionId = readString(detail.sessionId)
    ?? readString(detail.terminalSessionId)
    ?? readString(detail.id)
    ?? null;
  if (!sessionId) return null;
  const initialText = readString(detail.output ?? detail.tail ?? detail.preview ?? detail.log) ?? "";
  const command = readString(detail.command ?? detail.cmd ?? detail.previewCommand);
  const cwd = readString(detail.cwd ?? detail.directory ?? detail.path);
  return Object.freeze({ sessionId, command, cwd, initialText });
}

const STREAMING_LABELS: Record<StreamingState, string> = Object.freeze({
  pending: "Preview queued…",
  running: "Streaming preview…",
  ready: "",
  failed: "Preview failed",
});

const AgentApprovalCard = ({
  approval,
  onApprove,
  onApproveWithEdits,
  onReject,
  onCancel,
}: AgentApprovalCardProps) => {
  const [feedback, setFeedback] = useState<string>("");
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);

  const primaryPath = useMemo(() => extractPrimaryPath(approval.detail), [approval.detail]);
  const timestamp = useMemo(() => formatTimestamp(approval.createdAt), [approval.createdAt]);
  const editableArgs = useMemo(() => {
    if (isPlainRecord(approval.originalArgs)) {
      return { ...approval.originalArgs } as Readonly<Record<string, unknown>>;
    }
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  }, [approval.originalArgs]);

  const detailElement = useMemo(() => {
    const detail = approval.detail ?? null;
    if (!detail) return null;

    if (approval.tool === "edit") {
      const diffDetail = extractDiffPreview(detail);
      if (diffDetail) {
        return <DiffPreview detail={diffDetail} collapsedByDefault />;
      }
    }

    if (approval.tool === "terminal") {
      const terminal = extractTerminalPreview(detail);
      if (terminal) {
        const isActive = approval.streaming === "running";
        return (
          <TerminalOutputView
            sessionId={terminal.sessionId}
            previewId={String(approval.previewId)}
            command={terminal.command}
            cwd={terminal.cwd}
            initialText={terminal.initialText}
            isActive={isActive}
          />
        );
      }
    }

    return <JsonPreview value={detail} />;
  }, [approval.detail, approval.tool, approval.previewId, approval.streaming]);

  const buildFeedbackOptions = useCallback((): FeedbackOptions => {
    const trimmed = feedback.trim();
    if (trimmed.length === 0) return {};
    return { feedbackText: trimmed, feedbackMeta: null };
  }, [feedback]);

  const handleReject = useCallback(() => {
    onReject(buildFeedbackOptions());
  }, [buildFeedbackOptions, onReject]);

  const handleApprove = useCallback(() => {
    onApprove(buildFeedbackOptions());
  }, [buildFeedbackOptions, onApprove]);

  const handleApproveWithEdits = useCallback(() => {
    setEditModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setEditModalOpen(false);
  }, []);

  const handleModalSubmit = useCallback((content: Readonly<Record<string, unknown>>) => {
    setEditModalOpen(false);
    if (!onApproveWithEdits) return;
    onApproveWithEdits(content, buildFeedbackOptions());
  }, [buildFeedbackOptions, onApproveWithEdits]);

  const buttons = useMemo(() => getApprovalButtons({
    approval,
    streaming: approval.streaming,
    onApprove: handleApprove,
    onApproveWithEdits: onApproveWithEdits ? handleApproveWithEdits : undefined,
    onReject: handleReject,
    onCancel,
  }), [approval, approval.streaming, handleApprove, onApproveWithEdits, handleApproveWithEdits, handleReject, onCancel]);

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
        <a
          className="agent-approval-card__link"
          href={`#approval-timeline-${String(approval.previewId)}`}
        >
          View in timeline
        </a>
        {STREAMING_LABELS[approval.streaming] ? (
          <div
            className={`agent-approval-card__streaming agent-approval-card__streaming--${approval.streaming}`}
            role={approval.streaming === "failed" ? "alert" : "status"}
          >
            {STREAMING_LABELS[approval.streaming]}
          </div>
        ) : null}
        {detailElement}
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
      {onApproveWithEdits ? (
        <EditApprovalModal
          open={editModalOpen}
          onClose={handleModalClose}
          initialContent={editableArgs}
          approvalSummary={approval.summary}
          onSubmit={handleModalSubmit}
        />
      ) : null}
    </article>
  );
};

export default AgentApprovalCard;
