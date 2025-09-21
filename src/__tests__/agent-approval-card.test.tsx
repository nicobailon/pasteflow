import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";

import AgentApprovalCard from "../components/agent-approvals/agent-approval-card";
import type { ApprovalVm } from "../hooks/use-agent-approvals";

const baseApproval: ApprovalVm = {
  id: "00000000-0000-0000-0000-000000000222",
  previewId: "00000000-0000-0000-0000-000000000222" as ApprovalVm["previewId"],
  sessionId: "00000000-0000-0000-0000-000000000001" as ApprovalVm["sessionId"],
  toolExecutionId: 5,
  tool: "file",
  action: "write",
  summary: "Write file",
  detail: Object.freeze({ path: "/repo/index.ts" }),
  originalArgs: Object.freeze({ path: "/repo/index.ts", content: "console.log('hello');" }),
  createdAt: 1700000001000,
  hash: "hash",
  status: "pending",
  autoReason: null,
  feedbackText: null,
  feedbackMeta: null,
  streaming: "ready",
};

function renderCard(overrides?: Partial<ApprovalVm>, handlers?: {
  onApprove?: jest.Mock;
  onApproveWithEdits?: jest.Mock;
  onReject?: jest.Mock;
  onCancel?: jest.Mock;
}) {
  const approval = Object.freeze({ ...baseApproval, ...overrides }) as ApprovalVm;
  const onApprove = handlers?.onApprove ?? jest.fn();
  const onApproveWithEdits = handlers?.onApproveWithEdits ?? jest.fn();
  const onReject = handlers?.onReject ?? jest.fn();
  const onCancel = handlers?.onCancel ?? jest.fn();
  render(
    <AgentApprovalCard
      approval={approval}
      onApprove={onApprove}
      onApproveWithEdits={onApproveWithEdits}
      onReject={onReject}
      onCancel={onCancel}
    />
  );
  return { approval, onApprove, onApproveWithEdits, onReject, onCancel };
}

describe("AgentApprovalCard", () => {
  it("renders summary and path details", () => {
    renderCard();
    expect(screen.getByText("Write file")).toBeInTheDocument();
  });

  it("sends trimmed feedback on approve", () => {
    const { onApprove } = renderCard();
    const textarea = screen.getByLabelText(/Feedback/);
    fireEvent.change(textarea, { target: { value: "  Approved with notes  " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onApprove).toHaveBeenCalledWith({ feedbackText: "Approved with notes", feedbackMeta: null });
  });

  it("opens edit modal and submits edited payload", async () => {
    const { onApproveWithEdits } = renderCard({ tool: "edit" });
    fireEvent.click(screen.getByRole("button", { name: /save with edits/i }));
    const editor = await screen.findByLabelText(/JSON overrides/i);
    fireEvent.change(editor, { target: { value: '{"path":"/repo/index.ts","content":"updated"}' } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply edits/i }));
    });
    expect(onApproveWithEdits).toHaveBeenCalledWith(
      { path: "/repo/index.ts", content: "updated" },
      {}
    );
  });

  it("invokes reject handler with feedback", () => {
    const { onReject } = renderCard();
    const textarea = screen.getByLabelText(/Feedback/);
    fireEvent.change(textarea, { target: { value: "Needs revision" } });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith({ feedbackText: "Needs revision", feedbackMeta: null });
  });

  it("exposes cancel action for running terminal previews", () => {
    const { onCancel } = renderCard({ tool: "terminal", streaming: "running", detail: Object.freeze({ sessionId: "abc", command: "ls" }) });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables approve buttons until preview ready", () => {
    renderCard({ streaming: "pending" });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save with edits/i })).toBeDisabled();
  });
});
