import type { ApprovalVm, StreamingState } from "../../hooks/use-agent-approvals";

export type ApprovalButtonDescriptor = Readonly<{
  id: "approve" | "approveWithEdits" | "reject" | "cancel";
  kind: "primary" | "secondary" | "tertiary";
  label: string;
  disabled: boolean;
  onSelect: () => void;
}>;

export interface ApprovalButtonOptions {
  readonly approval: ApprovalVm;
  readonly streaming: StreamingState;
  readonly onApprove: () => void;
  readonly onApproveWithEdits?: () => void;
  readonly onReject: () => void;
  readonly onCancel?: () => void;
}

function isEditableTool(tool: ApprovalVm["tool"]): boolean {
  return tool === "edit" || tool === "file";
}

export function getApprovalButtons(options: ApprovalButtonOptions): readonly ApprovalButtonDescriptor[] {
  const {
    approval,
    streaming,
    onApprove,
    onApproveWithEdits,
    onReject,
    onCancel,
  } = options;

  const isReady = streaming === "ready";
  const isTerminalRunning = approval.tool === "terminal" && streaming === "running";
  const canEdit = isEditableTool(approval.tool) && typeof onApproveWithEdits === "function";

  const buttons: ApprovalButtonDescriptor[] = [];

  buttons.push({
    id: "approve",
    kind: "primary",
    label: "Approve",
    disabled: !isReady,
    onSelect: onApprove,
  });

  if (canEdit && typeof onApproveWithEdits === "function") {
    buttons.push({
      id: "approveWithEdits",
      kind: "primary",
      label: "Approve with edits",
      disabled: !isReady,
      onSelect: onApproveWithEdits,
    });
  }

  buttons.push({
    id: "reject",
    kind: "secondary",
    label: "Reject",
    disabled: false,
    onSelect: onReject,
  });

  if (isTerminalRunning && typeof onCancel === "function") {
    buttons.push({
      id: "cancel",
      kind: "secondary",
      label: "Cancel",
      disabled: false,
      onSelect: onCancel,
    });
  }

  return buttons;
}
