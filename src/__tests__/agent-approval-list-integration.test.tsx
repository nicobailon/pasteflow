import { act, fireEvent, render, screen, within } from "@testing-library/react";

import AgentApprovalList from "../components/agent-approvals/agent-approval-list";
import type { ApprovalVm } from "../hooks/use-agent-approvals";
import type { ApplyResult, StoredApproval } from "../main/agent/approvals-service";
import type { PreviewId, UnixMs } from "../main/agent/preview-registry";

const makeApproval = (suffix: string, overrides?: Partial<ApprovalVm>): ApprovalVm => ({
  id: `00000000-0000-0000-0000-00000000${suffix}`,
  previewId: `00000000-0000-0000-0000-00000000${suffix}` as ApprovalVm["previewId"],
  sessionId: "00000000-0000-0000-0000-000000000001" as ApprovalVm["sessionId"],
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
  ...overrides,
});

const asUnixMs = (value: number): UnixMs => value as UnixMs;

describe("AgentApprovalList", () => {
  it("renders approvals and invokes approve callback with options", async () => {
    const approvals = [makeApproval("301"), makeApproval("302")];
    const approve = jest.fn(async (id: string, options?: { readonly feedbackText?: string }) => ({
      ok: true as const,
      data: {
        status: "applied",
        approvalId: id,
        previewId: id as unknown as PreviewId,
        result: null,
      } satisfies ApplyResult,
    }));
    const approveWithEdits = jest.fn(async (id: string, content: unknown) => ({
      ok: true as const,
      data: {
        status: "applied",
        approvalId: id,
        previewId: id as unknown as PreviewId,
        result: content,
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
        autoApproved={[]}
        bypassEnabled={false}
        loading={false}
        error={null}
        onApprove={approve}
        onApproveWithEdits={approveWithEdits}
        onReject={(id, opts) => reject(id, opts)}
        onCancel={cancel}
      />
    );

    expect(screen.getAllByText(/Write file/).length).toBe(2);

    const targetCard = screen.getByText("Write file 301").closest("article");
    expect(targetCard).not.toBeNull();

    await act(async () => {
      fireEvent.click(within(targetCard as HTMLElement).getByRole("button", { name: /^approve$/i }));
    });

    expect(approve).toHaveBeenCalledWith(approvals[0].id, {});
  });

  it("renders auto-approved tray when items provided", () => {
    const autoApproved = [makeApproval("401", { status: "auto_approved", autoReason: "rule" })];
    render(
      <AgentApprovalList
        approvals={[]}
        autoApproved={autoApproved}
        bypassEnabled={false}
        loading={false}
        error={null}
        onApprove={async () => ({ ok: true as const, data: { status: "applied", approvalId: "", previewId: "" as unknown as PreviewId, result: null } })}
        onApproveWithEdits={async () => ({ ok: true as const, data: { status: "applied", approvalId: "", previewId: "" as unknown as PreviewId, result: null } })}
        onReject={async () => ({
          ok: true as const,
          data: {
            id: autoApproved[0].id,
            previewId: autoApproved[0].previewId,
            sessionId: autoApproved[0].sessionId,
            status: "rejected" as const,
            createdAt: asUnixMs(autoApproved[0].createdAt),
            resolvedAt: asUnixMs(autoApproved[0].createdAt),
            resolvedBy: "tester",
            autoReason: null,
            feedbackText: null,
            feedbackMeta: null,
          } satisfies StoredApproval,
        })}
        onCancel={async () => ({ ok: true as const, data: null })}
      />
    );

    expect(screen.getByText(/Auto-approved/)).toBeInTheDocument();
    expect(screen.getByText(/rule/)).toBeInTheDocument();
  });

  it("shows empty state when no approvals", () => {
    render(
      <AgentApprovalList
        approvals={[]}
        autoApproved={[]}
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
        onApproveWithEdits={async () => ({
          ok: true as const,
          data: {
            status: "applied",
            approvalId: "",
            previewId: "" as unknown as PreviewId,
            result: null,
          } satisfies ApplyResult,
        })}
        onReject={async () => ({
          ok: true as const,
          data: {
            id: "",
            previewId: "" as unknown as PreviewId,
            sessionId: "",
            status: "rejected" as const,
            createdAt: asUnixMs(Date.now()),
            resolvedAt: asUnixMs(Date.now()),
            resolvedBy: "tester",
            autoReason: null,
            feedbackText: null,
            feedbackMeta: null,
          } satisfies StoredApproval,
        })}
        onCancel={async () => ({ ok: true as const, data: null })}
      />
    );

    expect(screen.getByText(/No approvals waiting/i)).toBeInTheDocument();
  });
});
