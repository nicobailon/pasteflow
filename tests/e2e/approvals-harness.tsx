import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import AgentApprovalList from "../../src/components/agent-approvals/agent-approval-list";
import type { ApprovalVm } from "../../src/hooks/use-agent-approvals";
import type { ApplyResult, ServiceResult, StoredApproval } from "../../src/main/agent/approvals-service";
import type { ChatSessionId } from "../../src/main/agent/preview-registry";
import type { UnixMs } from "../../src/main/db/database-implementation";

import "../../src/components/agent-approvals/agent-approvals.css";

const SESSION_ID = "00000000-0000-0000-0000-000000000777" as unknown as ChatSessionId;

type Result<T> = ServiceResult<T>;

const now = Date.now();

const makePending = (idSuffix: string, overrides?: Partial<ApprovalVm>): ApprovalVm => ({
  id: `00000000-0000-0000-0000-00000000${idSuffix}`,
  previewId: `00000000-0000-0000-0000-00000000${idSuffix}` as unknown as ApprovalVm["previewId"],
  sessionId: SESSION_ID,
  toolExecutionId: Number(idSuffix),
  tool: overrides?.tool ?? "file",
  action: overrides?.action ?? "write",
  summary: overrides?.summary ?? `Write file ${idSuffix}`,
  detail: overrides?.detail ?? Object.freeze({ path: `/repo/file-${idSuffix}.ts` }),
  originalArgs: overrides?.originalArgs ?? Object.freeze({ path: `/repo/file-${idSuffix}.ts`, content: "export {};" }),
  createdAt: overrides?.createdAt ?? (now + Number(idSuffix)) as UnixMs,
  hash: overrides?.hash ?? `hash-${idSuffix}`,
  status: "pending",
  autoReason: null,
  feedbackText: null,
  feedbackMeta: null,
  streaming: overrides?.streaming ?? "ready",
});

const makeAutoApproved = (idSuffix: string): ApprovalVm => ({
  ...makePending(idSuffix),
  status: "auto_approved",
  autoReason: "terminal bypass",
});

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(message: string): Result<T> => ({ ok: false, error: { code: "HARNESS_ERROR", message } });
const formatFeedbackSuffix = (feedback?: string) => {
  const trimmed = feedback?.trim();
  return trimmed && trimmed.length > 0 ? ` with feedback: ${trimmed}` : "";
};

export default function ApprovalsHarness() {
  const [pending, setPending] = useState<ApprovalVm[]>(() => [
    makePending("301"),
    makePending("302", {
      tool: "terminal",
      summary: "Terminal command",
      detail: Object.freeze({ command: "sleep 5", sessionId: "term-1" }),
      streaming: "running",
    }),
    makePending("303", { summary: "Review logging" }),
  ]);
  const [autoApproved] = useState<ApprovalVm[]>(() => [makeAutoApproved("401")]);
  const [bypassEnabled, setBypassEnabled] = useState<boolean>(false);
  const [log, setLog] = useState<string[]>([]);

  const appendLog = (message: string) => setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);

  const handleApprove = async (approvalId: string, options?: { readonly feedbackText?: string }): Promise<Result<ApplyResult>> => {
    const match = pending.find((item) => item.id === approvalId);
    if (!match) return fail("Missing approval");
    setPending((prev) => prev.filter((item) => item.id !== approvalId));
    appendLog(`Approved ${approvalId}${formatFeedbackSuffix(options?.feedbackText)}`);
    return ok({ status: "applied", approvalId, previewId: match.previewId, result: { via: "approve" } });
  };

  const handleApproveWithEdits = async (approvalId: string, content: unknown, options?: { readonly feedbackText?: string }): Promise<Result<ApplyResult>> => {
    const match = pending.find((item) => item.id === approvalId);
    if (!match) return fail("Missing approval");
    setPending((prev) => prev.filter((item) => item.id !== approvalId));
    const suffix = options?.feedbackText && options.feedbackText.trim().length > 0
      ? ` (feedback: ${options.feedbackText})`
      : "";
    appendLog(`Approved with edits ${approvalId}: ${JSON.stringify(content)}${suffix}`);
    return ok({ status: "applied", approvalId, previewId: match.previewId, result: { via: "approveWithEdits", content } });
  };

  const handleReject = async (approvalId: string, options?: { readonly feedbackText?: string }): Promise<Result<StoredApproval>> => {
    const match = pending.find((item) => item.id === approvalId);
    if (!match) return fail("Missing approval");
    setPending((prev) => prev.filter((item) => item.id !== approvalId));
    appendLog(`Rejected ${approvalId}: ${options?.feedbackText ?? "(no feedback)"}`);
    return ok({
      id: approvalId,
      previewId: match.previewId,
      sessionId: match.sessionId,
      status: "rejected",
      createdAt: match.createdAt,
      resolvedAt: (Date.now()) as UnixMs,
      resolvedBy: "tester",
      autoReason: null,
      feedbackText: options?.feedbackText ?? null,
      feedbackMeta: null,
    });
  };

  const handleCancel = async (previewId: string): Promise<Result<null>> => {
    setPending((prev) => prev.filter((item) => String(item.previewId) !== previewId));
    appendLog(`Cancelled ${previewId}`);
    return ok(null);
  };

  const pendingCount = useMemo(() => pending.length, [pending]);

  return (
    <div>
      <h2>Approvals Harness</h2>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }} data-testid="bypass-toggle">
        <input
          type="checkbox"
          checked={bypassEnabled}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setBypassEnabled(next);
            appendLog(`Bypass ${next ? "enabled" : "disabled"}`);
          }}
        />
        <span>Bypass approvals</span>
      </label>
      <p data-testid="pending-count">Pending count: {pendingCount}</p>
      <AgentApprovalList
        approvals={pending}
        autoApproved={autoApproved}
        bypassEnabled={bypassEnabled}
        loading={false}
        error={null}
        onApprove={(id, opts) => handleApprove(id, opts)}
        onApproveWithEdits={(id, content, opts) => handleApproveWithEdits(id, content, opts)}
        onReject={(id, options) => handleReject(id, options)}
        onCancel={(previewId) => handleCancel(previewId)}
      />
      <div className="harness-log" data-testid="harness-log">
        <h4>Action log</h4>
        <ul>
          {log.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const container = document.querySelector<HTMLElement>("#root");
if (!container) throw new Error("Harness root missing");

const root = createRoot(container);
root.render(<ApprovalsHarness />);
