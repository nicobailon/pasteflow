import { useCallback, useMemo } from "react";
import type { KeyboardEvent } from "react";

import type { ApprovalVm, StreamingState } from "../../hooks/use-agent-approvals";

export interface ApprovalRowCompactProps {
  readonly vm: ApprovalVm;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly onExpand: () => void;
  readonly registerRef?: (node: HTMLDivElement | null) => void;
}

function extractPrimaryPath(detail: Readonly<Record<string, unknown>> | null): string | null {
  if (!detail) return null;
  const pathLike = (detail as Record<string, unknown>).path
    ?? (detail as Record<string, unknown>).file
    ?? (detail as Record<string, unknown>).targetPath
    ?? (detail as Record<string, unknown>).destination;
  return typeof pathLike === "string" ? pathLike : null;
}

function formatAge(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

const STREAMING_LABELS: Record<StreamingState, string> = Object.freeze({
  pending: "Queued…",
  running: "Streaming…",
  ready: "",
  failed: "Failed",
});

const STREAMING_TITLES: Partial<Record<StreamingState, string>> = Object.freeze({
  pending: "Preview is queued",
  running: "Preview still running",
});

export default function ApprovalRowCompact({ vm, onApprove, onReject, onExpand, registerRef }: ApprovalRowCompactProps) {
  const path = useMemo(() => extractPrimaryPath(vm.detail), [vm.detail]);
  const age = useMemo(() => formatAge(vm.createdAt), [vm.createdAt]);
  const approveDisabled = vm.streaming !== "ready";

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Enter expands detail
    if (event.key === "Enter") {
      event.preventDefault();
      onExpand();
      return;
    }
    // A approves, R rejects
    if ((event.key === "a" || event.key === "A")) {
      event.preventDefault();
      if (!approveDisabled) onApprove();
      return;
    }
    if ((event.key === "r" || event.key === "R")) {
      event.preventDefault();
      onReject();
      return;
    }
    // Up/Down arrow moves focus between rows (delegated to list container)
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      try {
        window.dispatchEvent(new CustomEvent("agent:approvals:move-focus", { detail: { dir, from: vm.id } }));
      } catch {
        // ignore
      }
    }
  }, [onApprove, onReject, onExpand, vm.id, approveDisabled]);

  const approveLabel = "Approve";
  const rejectLabel = "Reject";
  const approveTitle = vm.tool === "terminal" ? "Run command (requires approval)" : undefined;

  return (
    <div
      ref={registerRef}
      className={`approval-row-compact approval-row-compact--${vm.streaming}`}
      role="option"
      aria-selected="false"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-approval-id={vm.id}
    >
      <div className="approval-row-compact__main">
        <div className="approval-row-compact__left">
          <span className="approval-row-compact__tool" aria-label="Tool">{vm.tool}</span>
          <span className="approval-row-compact__action" aria-label="Action">{vm.action}</span>
          <span className="approval-row-compact__summary" title={vm.summary}>{vm.summary}</span>
          {path ? (
            <span className="approval-row-compact__path" title={path}>{path}</span>
          ) : null}
        </div>

        <div className="approval-row-compact__right">
          <span
            className={`approval-row-compact__status approval-row-compact__status--${vm.streaming}`}
            title={STREAMING_TITLES[vm.streaming]}
            role={vm.streaming === "failed" ? "alert" : "status"}
            aria-label={STREAMING_LABELS[vm.streaming]}
          >
            {(vm.streaming === "pending" || vm.streaming === "running") ? <span className="spinner" aria-hidden="true" /> : null}
          </span>
          <time className="approval-row-compact__age" dateTime={new Date(vm.createdAt).toISOString()}>{age}</time>
        </div>
      </div>

      <div className="approval-row-compact__actions">
        <button
          type="button"
          className="approval-row-compact__chip approval-row-compact__chip--primary"
          onClick={onApprove}
          disabled={approveDisabled}
          title={approveTitle}
        >
          {approveLabel}
        </button>
        <button
          type="button"
          className="approval-row-compact__chip approval-row-compact__chip--secondary"
          onClick={onReject}
        >
          {rejectLabel}
        </button>
        <button
          type="button"
          className="approval-row-compact__chip approval-row-compact__chip--tertiary"
          onClick={onExpand}
          aria-label="Expand details"
          title="View details"
        >
          Details
        </button>
      </div>
    </div>
  );
}