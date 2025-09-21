import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApprovalVm } from "../../hooks/use-agent-approvals";
import type { ApplyResult, ServiceResult, StoredApproval } from "../../main/agent/approvals-service";

import ApprovalRowCompact from "./approval-row-compact";
import ApprovalDetailPanel from "./approval-detail-panel";

export interface ApprovalListCompactProps {
  readonly approvals: readonly ApprovalVm[];
  readonly onApprove: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<ApplyResult>>;
  readonly onApproveWithEdits: (approvalId: string, content: Readonly<Record<string, unknown>>, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<ApplyResult>>;
  readonly onReject: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<ServiceResult<StoredApproval>>;
  readonly onCancel: (previewId: string) => Promise<ServiceResult<null>>;
}

export default function ApprovalListCompact({
  approvals,
  onApprove,
  onApproveWithEdits,
  onReject,
  onCancel,
}: ApprovalListCompactProps) {
  const [detailVm, setDetailVm] = useState<ApprovalVm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const sortedApprovals = useMemo(() => {
    const list = [...approvals];
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [approvals]);

  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const node = rowRefs.current.get(id);
      node?.focus();
    });
  }, []);

  const findNextFocusId = useCallback((currentId: string): string | null => {
    const index = sortedApprovals.findIndex((item) => item.id === currentId);
    if (index === -1) return null;
    const next = sortedApprovals[index + 1] ?? sortedApprovals[index - 1];
    return next?.id ?? null;
  }, [sortedApprovals]);

  const registerRowRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(id, node);
    } else {
      rowRefs.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const handleMoveFocus = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { dir?: number; from?: string } | null;
      if (!detail || typeof detail.dir !== "number" || typeof detail.from !== "string") return;
      const index = sortedApprovals.findIndex((item) => item.id === detail.from);
      if (index === -1) return;
      const target = sortedApprovals[index + detail.dir];
      if (!target) return;
      focusRow(target.id);
    };

    window.addEventListener("agent:approvals:move-focus", handleMoveFocus as EventListener);
    return () => {
      window.removeEventListener("agent:approvals:move-focus", handleMoveFocus as EventListener);
    };
  }, [focusRow, sortedApprovals]);

  const handleApprove = useCallback(async (id: string) => {
    const nextFocusId = findNextFocusId(id);
    setBusyId(id);
    try {
      const result = await onApprove(id);
      if (result.ok) {
        setLastMessage(null);
        // Close detail if it was open for this row
        setDetailVm((prev) => (prev?.id === id ? null : prev));
        focusRow(nextFocusId);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
      setBusyId((prev) => (prev === id ? null : prev));
    }
  }, [findNextFocusId, focusRow, onApprove]);

  const handleReject = useCallback(async (id: string) => {
    const nextFocusId = findNextFocusId(id);
    setBusyId(id);
    try {
      const result = await onReject(id);
      if (result.ok) {
        setLastMessage(null);
        setDetailVm((prev) => (prev?.id === id ? null : prev));
        focusRow(nextFocusId);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
      setBusyId((prev) => (prev === id ? null : prev));
    }
  }, [findNextFocusId, focusRow, onReject]);

  const handleApproveWithEditsFromPanel = useCallback(async (vm: ApprovalVm, content: Readonly<Record<string, unknown>>) => {
    const nextFocusId = findNextFocusId(vm.id);
    setBusyId(vm.id);
    try {
      const result = await onApproveWithEdits(vm.id, content);
      if (result.ok) {
        setLastMessage(null);
        setDetailVm(null);
        focusRow(nextFocusId);
      } else {
        setLastMessage(result.error.message);
      }
    } finally {
      setBusyId((prev) => (prev === vm.id ? null : prev));
    }
  }, [findNextFocusId, focusRow, onApproveWithEdits]);

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
      setBusyId((prev) => (prev === previewId ? null : prev));
    }
  }, [onCancel]);

  const infoMessage = lastMessage ? (
    <div className="approval-list-compact__status approval-list-compact__status--info" role="status">{lastMessage}</div>
  ) : null;

  const busyNotice = busyId ? (
    <div className="approval-list-compact__busy" aria-live="assertive">Processing…</div>
  ) : null;

  return (
    <div className="approval-list-compact" role="listbox" aria-label="Pending approvals (compact)" aria-multiselectable="false">
      <div className="approval-list-compact__items">
        {sortedApprovals.map((vm) => (
          <ApprovalRowCompact
            key={vm.id}
            vm={vm}
            onApprove={() => handleApprove(vm.id)}
            onReject={() => handleReject(vm.id)}
            onExpand={() => setDetailVm(vm)}
            registerRef={(node) => registerRowRef(vm.id, node)}
          />
        ))}
      </div>

      {infoMessage}
      {busyNotice}

      {detailVm ? (
        <ApprovalDetailPanel
          vm={detailVm}
          open={true}
          onClose={() => setDetailVm(null)}
          onApprove={() => void handleApprove(detailVm.id)}
          onApproveWithEdits={detailVm.tool === "edit" ? (content) => void handleApproveWithEditsFromPanel(detailVm, content) : undefined}
          onReject={() => void handleReject(detailVm.id)}
          onCancel={(detailVm.streaming === "pending" || detailVm.streaming === "running") ? (() => void handleCancel(String(detailVm.previewId))) : undefined}
        />
      ) : null}
    </div>
  );
}