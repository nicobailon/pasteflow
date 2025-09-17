import { act, fireEvent, render, screen, within } from "@testing-library/react";

import AgentApprovalList from "../components/agent-approvals/agent-approval-list";
import type { ApprovalVm } from "../hooks/use-agent-approvals";
import type { ApplyResult, StoredApproval } from "../main/agent/approvals-service";
import type { PreviewId, UnixMs } from "../main/agent/preview-registry";

const makeApproval = (suffix: string): ApprovalVm => ({
  id: `00000000-0000-0000-0000-00000000${suffix}`,
  previewId: `00000000-0000-0000-0000-00000000${suffix}` as unknown as ApprovalVm["previewId"],
  sessionId: "00000000-0000-0000-0000-000000000001" as unknown as ApprovalVm["sessionId"],
  toolExecutionId: Number(suffix),
  tool: "file",
  action: "write",
  summary: `Write file ${suffix}`,
  detail: Object.freeze({ path: `/repo/file-${suffix}.ts` }),
  originalArgs: Object.freeze({ path: `/repo/file-${suffix}.ts`, content: "export {};" }),
  createdAt: 1700000000000,
  hash: `hash-${suffix}`,
  status: "pending",
  autoReason: null,
  feedbackText: null,
  feedbackMeta: null,
  streaming: "ready",
});

const asUnixMs = (value: number): UnixMs => value as unknown as UnixMs;

describe("AgentApprovalList", () => {
  it("renders approvals and triggers approve callback", async () => {
    const approvals = [makeApproval("301"), makeApproval("302")];
    const approve = jest.fn(async (id: string) => ({
      ok: true as const,
      data: {
        status: "applied",
        approvalId: id,
        previewId: id as unknown as PreviewId,
        result: null,
      } satisfies ApplyResult,
    }));
    const reject = jest.fn(async (id: string, options?: { readonly feedbackText?: string }) => ({
      ok: true as const,
      data: {
        id,
        previewId: id as unknown as PreviewId,
        sessionId: approvals[0].sessionId,
        status: "rejected" as const,
        createdAt: asUnixMs(approvals[0].createdAt),
        resolvedAt: asUnixMs(approvals[0].createdAt + 1),
        resolvedBy: "tester",
        autoReason: null,
        feedbackText: options?.feedbackText ?? null,
        feedbackMeta: null,
      } satisfies StoredApproval,
    }));
    const cancel = jest.fn(async () => ({ ok: true as const, data: null }));

    render(
      <AgentApprovalList
        approvals={approvals}
        bypassEnabled={false}
        loading={false}
        error={null}
        onApprove={approve}
        onReject={(id, opts) => reject(id, opts)}
        onCancel={cancel}
      />
    );

    expect(screen.getByText(/Pending approvals/)).toBeInTheDocument();
    expect(screen.getAllByText(/Write file/).length).toBe(2);

    const targetCard = screen.getByText("Write file 301").closest("article");
    expect(targetCard).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(targetCard as HTMLElement).getByRole("button", { name: /Approve/ }));
    });

    expect(approve).toHaveBeenCalledWith(approvals[0].id);
  });

  it("shows empty state when no approvals", () => {
    const fallback = makeApproval("400");
    render(
      <AgentApprovalList
        approvals={[]}
        bypassEnabled={true}
        loading={false}
        error={null}
        onApprove={async () => ({
          ok: true as const,
          data: {
            status: "applied",
            approvalId: "",
            previewId: "" as unknown as PreviewId,
            result: null,
          } satisfies ApplyResult,
        })}
        onReject={async (id, options) => ({
          ok: true as const,
          data: {
            id,
            previewId: id as unknown as PreviewId,
            sessionId: fallback.sessionId,
            status: "rejected" as const,
            createdAt: asUnixMs(fallback.createdAt),
            resolvedAt: asUnixMs(fallback.createdAt),
            resolvedBy: "tester",
            autoReason: null,
            feedbackText: options?.feedbackText ?? null,
            feedbackMeta: null,
          } satisfies StoredApproval,
        })}
        onCancel={async () => ({ ok: true as const, data: null })}
      />
    );

    expect(screen.getByText(/No approvals waiting/i)).toBeInTheDocument();
  });
});
