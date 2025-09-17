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
  readonly bypassEnabled: boolean;
  readonly onApprove: () => void;
  readonly onApproveWithEdits?: () => void;
  readonly onReject: () => void;
  readonly onCancel?: () => void;
}

export function getApprovalButtons(options: ApprovalButtonOptions): readonly ApprovalButtonDescriptor[] {
  const {
    streaming,
    bypassEnabled,
    onApprove,
    onApproveWithEdits,
    onReject,
    onCancel,
  } = options;

  const isReady = streaming === "ready";
  const buttons: ApprovalButtonDescriptor[] = [];

  buttons.push({
    id: "approve",
    kind: "primary",
    label: bypassEnabled ? "Apply now" : "Approve",
    disabled: !isReady,
    onSelect: onApprove,
  });

  if (typeof onApproveWithEdits === "function") {
    buttons.push({
      id: "approveWithEdits",
      kind: "secondary",
      label: "Apply with edits",
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

  if (typeof onCancel === "function") {
    buttons.push({
      id: "cancel",
      kind: "tertiary",
      label: "Cancel preview",
      disabled: false,
      onSelect: onCancel,
    });
  }

  return buttons;
}
