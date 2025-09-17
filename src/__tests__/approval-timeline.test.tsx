import { render, screen } from "@testing-library/react";

import ApprovalTimeline from "../components/agent-approvals/approval-timeline";

describe("ApprovalTimeline", () => {
  const originalElectron = (window as any).electron;

  afterEach(() => {
    (window as any).electron = originalElectron;
    jest.clearAllMocks();
  });

  it("renders entries from approvals list", async () => {
    const preview = {
      id: "preview-1",
      sessionId: "session-1",
      toolExecutionId: 1,
      tool: "edit",
      action: "diff",
      summary: "Update foo.ts",
      detail: { path: "src/foo.ts" },
      originalArgs: {},
      createdAt: 1_700_000_000_000,
      hash: "hash",
    };
    const approval = {
      id: "preview-1",
      previewId: "preview-1",
      sessionId: "session-1",
      status: "pending",
      createdAt: 1_700_000_000_100,
      resolvedAt: null,
      resolvedBy: null,
      autoReason: null,
      feedbackText: null,
      feedbackMeta: null,
    };

    const list = jest.fn(async () => ({ ok: true, data: { previews: [preview], approvals: [approval] } }));
    const watch = jest.fn(() => () => {});

    (window as any).electron = {
      approvals: { list, watch },
    };

    render(<ApprovalTimeline sessionId="session-1" approvalsEnabled />);

    expect(await screen.findByText(/Update foo.ts/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });
});
