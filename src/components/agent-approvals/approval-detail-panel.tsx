import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { ApprovalVm, StreamingState } from "../../hooks/use-agent-approvals";
import { isPlainRecord } from "../../utils/approvals-parsers";

import DiffPreview from "./diff-preview";
import JsonPreview from "./json-preview";
import TerminalOutputView from "./terminal-output-view";
import EditApprovalModal from "./edit-approval-modal";

export interface ApprovalDetailPanelProps {
  readonly vm: ApprovalVm;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApprove: () => void;
  readonly onApproveWithEdits?: (content: Readonly<Record<string, unknown>>) => void;
  readonly onReject: () => void;
  readonly onCancel?: () => void;
}

function extractPrimaryPath(detail: Readonly<Record<string, unknown>> | null): string | null {
  if (!detail) return null;
  const rec = detail as Record<string, unknown>;
  const pathLike = rec.path ?? rec.file ?? rec.targetPath ?? rec.destination;
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
  const diff = readString(detail.diff ?? (detail as Record<string, unknown>).patch ?? (detail as Record<string, unknown>).delta);
  const original = readString((detail as Record<string, unknown>).original);
  const modified = readString((detail as Record<string, unknown>).modified);
  const tokenCounts = readTokenCounts((detail as Record<string, unknown>).tokenCounts ?? null);
  const existed = typeof (detail as Record<string, unknown>).existed === "boolean" ? (detail as Record<string, unknown>).existed as boolean : null;
  const applied = typeof (detail as Record<string, unknown>).applied === "boolean" ? (detail as Record<string, unknown>).applied as boolean : null;
  const error = readString((detail as Record<string, unknown>).error ?? (detail as Record<string, unknown>).reason);
  const bytes = readNumber((detail as Record<string, unknown>).bytes);
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
  const rec = detail as Record<string, unknown>;
  const sessionId = readString(rec.sessionId) ?? readString(rec.terminalSessionId) ?? readString(rec.id) ?? null;
  if (!sessionId) return null;
  const initialText = readString(rec.output ?? rec.tail ?? rec.preview ?? rec.log) ?? "";
  const command = readString(rec.command ?? rec.cmd ?? rec.previewCommand);
  const cwd = readString(rec.cwd ?? rec.directory ?? rec.path);
  return Object.freeze({ sessionId, command, cwd, initialText });
}

const STREAMING_LABELS: Record<StreamingState, string> = Object.freeze({
  pending: "Preview queued…",
  running: "Streaming preview…",
  ready: "",
  failed: "Preview failed",
});

const STREAMING_TITLES: Partial<Record<StreamingState, string>> = Object.freeze({
  pending: "Preview is queued",
  running: "Preview still running",
});

function primaryApproveLabel(tool: string): string {
  if (tool === "edit" || tool === "file") return "Save";
  if (tool === "terminal") return "Run Command";
  return "Approve";
}

function primaryApproveTitle(tool: string): string | undefined {
  if (tool === "terminal") return "Run command (requires approval)";
  return undefined;
}

export default function ApprovalDetailPanel({ vm, open, onClose, onApprove, onApproveWithEdits, onReject, onCancel }: ApprovalDetailPanelProps) {
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);

  const primaryPath = useMemo(() => extractPrimaryPath(vm.detail), [vm.detail]);
  const detailElement = useMemo(() => {
    const detail = vm.detail ?? null;
    if (!detail) return null;

    if (vm.tool === "edit") {
      const diffDetail = extractDiffPreview(detail);
      if (diffDetail) {
        return <DiffPreview detail={diffDetail} collapsedByDefault />;
      }
    }

    if (vm.tool === "terminal") {
      const terminal = extractTerminalPreview(detail);
      if (terminal) {
        const isActive = vm.streaming === "running";
        return (
          <TerminalOutputView
            sessionId={terminal.sessionId}
            previewId={String(vm.previewId)}
            command={terminal.command}
            cwd={terminal.cwd}
            initialText={terminal.initialText}
            isActive={isActive}
          />
        );
      }
    }

    return <JsonPreview value={detail} />;
  }, [vm.detail, vm.tool, vm.previewId, vm.streaming]);

  const editableArgs = useMemo(() => {
    if (isPlainRecord(vm.originalArgs)) {
      return { ...vm.originalArgs } as Readonly<Record<string, unknown>>;
    }
    return Object.freeze({}) as Readonly<Record<string, unknown>>;
  }, [vm.originalArgs]);

  const approveDisabled = vm.streaming !== "ready";
  const canCancel = (vm.streaming === "pending" || vm.streaming === "running") && typeof onCancel === "function";

  const handleApprove = useCallback(() => {
    if (!approveDisabled) onApprove();
  }, [approveDisabled, onApprove]);

  const handleApproveWithEdits = useCallback(() => {
    if (!onApproveWithEdits || approveDisabled) return;
    setEditOpen(true);
  }, [onApproveWithEdits, approveDisabled]);

  const handleEditClose = useCallback(() => {
    setEditOpen(false);
    requestAnimationFrame(() => {
      editButtonRef.current?.focus();
    });
  }, []);

  const handleEditSubmit = useCallback((content: Readonly<Record<string, unknown>>) => {
    setEditOpen(false);
    if (onApproveWithEdits) {
      onApproveWithEdits(content);
    }
  }, [onApproveWithEdits]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const isReady = vm.streaming === "ready";
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (isReady) {
        onApprove();
      }
      return;
    }
    if (event.shiftKey && event.key === "Enter" && onApproveWithEdits) {
      event.preventDefault();
      if (isReady) {
        setEditOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }, [vm.streaming, onApprove, onApproveWithEdits, onClose]);

  const primaryLabel = primaryApproveLabel(vm.tool);
  const primaryTitle = primaryApproveTitle(vm.tool);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal-content approval-detail-panel"
          aria-describedby="approval-detail-help"
          onKeyDown={handleKeyDown}
        >
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Review requested changes</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <p id="approval-detail-help" className="sr-only">
            Review the request details, then approve, approve with edits, reject, or cancel if still streaming.
          </p>

          <header className="approval-detail-panel__header">
            <div className="approval-detail-panel__title">
              <span className="approval-detail-panel__tool" aria-label="Tool">{vm.tool}</span>
              <span className="approval-detail-panel__action" aria-label="Action">{vm.action}</span>
              {primaryPath ? (
                <span className="approval-detail-panel__path" title={primaryPath}>{primaryPath}</span>
              ) : null}
            </div>
            <div
              className={`approval-detail-panel__streaming approval-detail-panel__streaming--${vm.streaming}`}
              role={vm.streaming === "failed" ? "alert" : "status"}
              title={STREAMING_TITLES[vm.streaming]}
            >
              {(vm.streaming === "pending" || vm.streaming === "running") ? <span className="spinner" aria-hidden="true" /> : null}
              {STREAMING_LABELS[vm.streaming]}
            </div>
          </header>

          <div className="approval-detail-panel__body">
            {vm.tool === "terminal" ? (
              <div className="agent-approval-card__warning" role="alert">Command execution requires explicit approval.</div>
            ) : null}
            {vm.autoReason ? (
              <div className="approval-detail-panel__badge">Auto rule: {vm.autoReason}</div>
            ) : null}
            {detailElement}
          </div>

          <footer className="approval-detail-panel__footer">
            <div className="approval-detail-panel__buttons">
              <button
                type="button"
                className="approval-detail-panel__button approval-detail-panel__button--primary"
                onClick={handleApprove}
                disabled={approveDisabled}
                title={primaryTitle}
              >
                {primaryLabel}
              </button>
              {onApproveWithEdits && (vm.tool === "edit" || vm.tool === "file") ? (
                <button
                  type="button"
                  className="approval-detail-panel__button approval-detail-panel__button--secondary"
                  onClick={handleApproveWithEdits}
                  disabled={approveDisabled}
                  ref={editButtonRef}
                  title="Apply with JSON edits"
                >
                  Save with edits
                </button>
              ) : null}
              {canCancel ? (
                <button
                  type="button"
                  className="approval-detail-panel__button approval-detail-panel__button--tertiary"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                className="approval-detail-panel__button approval-detail-panel__button--tertiary"
                onClick={onReject}
              >
                Reject
              </button>
            </div>
          </footer>

          {onApproveWithEdits ? (
            <EditApprovalModal
              open={editOpen}
              approvalSummary={vm.summary}
              initialContent={editableArgs}
              onClose={handleEditClose}
              onSubmit={handleEditSubmit}
              focusReturnRef={editButtonRef}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}