import { fireEvent, render, screen } from "@testing-library/react";

import AgentApprovalCard from "../components/agent-approvals/agent-approval-card";
import type { ApprovalVm } from "../hooks/use-agent-approvals";

const sampleApproval: ApprovalVm = {
  id: "00000000-0000-0000-0000-000000000222",
  previewId: "00000000-0000-0000-0000-000000000222" as unknown as ApprovalVm["previewId"],
  sessionId: "00000000-0000-0000-0000-000000000001" as unknown as ApprovalVm["sessionId"],
  toolExecutionId: 5,
  tool: "terminal",
  action: "run",
  summary: "Run npm test",
  detail: Object.freeze({ command: "npm test", path: "/repo" }),
  originalArgs: Object.freeze({ command: "npm test" }),
  createdAt: 1700000001000,
  hash: "hash",
  status: "pending",
  autoReason: null,
  feedbackText: null,
  feedbackMeta: null,
  streaming: "ready",
};

describe("AgentApprovalCard", () => {
  it("renders summary and detail information", () => {
    render(
      <AgentApprovalCard
        approval={sampleApproval}
        bypassEnabled={false}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );

    expect(screen.getByText("Run npm test")).toBeInTheDocument();
    expect(screen.getByText(/command/)).toBeInTheDocument();
  });

  it("calls approve and reject handlers", () => {
    const approve = jest.fn();
    const reject = jest.fn();

    render(
      <AgentApprovalCard
        approval={sampleApproval}
        bypassEnabled={false}
        onApprove={approve}
        onReject={reject}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    expect(approve).toHaveBeenCalled();

    const textarea = screen.getByLabelText(/Feedback/);
    fireEvent.change(textarea, { target: { value: "Needs revision" } });
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    expect(reject).toHaveBeenCalledWith({ feedbackText: "Needs revision", feedbackMeta: null });
  });
});
