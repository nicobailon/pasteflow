import { act, renderHook, waitFor } from "@testing-library/react";

import useAgentApprovals from "../hooks/use-agent-approvals";

type InvokeFn = (channel: string, payload?: unknown) => Promise<unknown>;

declare global {
  interface Window {
    electron?: {
      approvals?: {
        list: jest.Mock<Promise<unknown>, [payload: { sessionId: string }] >;
        apply: jest.Mock<Promise<unknown>, [payload: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }] >;
        applyWithContent: jest.Mock<Promise<unknown>, [payload: { approvalId: string; content: unknown; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }] >;
        reject: jest.Mock<Promise<unknown>, [payload: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }] >;
        cancel: jest.Mock<Promise<unknown>, [payload: { previewId: string }] >;
        getRules: jest.Mock<Promise<unknown>, []>;
        setRules: jest.Mock<Promise<unknown>, [payload: { rules: readonly unknown[] }]>;
        watch: jest.Mock<() => () => void, [handlers: { onNew?: (payload: unknown) => void; onUpdate?: (payload: unknown) => void; onReady?: (payload: unknown) => void; onError?: (payload: unknown) => void }]>;
      };
      ipcRenderer?: {
        invoke: InvokeFn;
        on: jest.Mock<void, [channel: string, listener: (...args: unknown[]) => void]>;
        removeListener: jest.Mock<void, [channel: string, listener: (...args: unknown[]) => void]>;
      };
    };
  }
}

const sessionId = "00000000-0000-0000-0000-000000000001";
const previewId = "00000000-0000-0000-0000-000000000101";

const previewPayload = {
  id: previewId,
  sessionId,
  toolExecutionId: 12,
  tool: "file",
  action: "write",
  summary: "file write preview",
  detail: { path: "/app/index.ts" },
  originalArgs: { path: "/app/index.ts", content: "console.log('hi')" },
  createdAt: 1700000000000,
  hash: "abc123",
};

const approvalPayload = {
  id: previewId,
  previewId,
  sessionId,
  status: "pending",
  createdAt: 1700000000000,
  resolvedAt: null,
  resolvedBy: null,
  autoReason: null,
  feedbackText: null,
  feedbackMeta: null,
};

describe("useAgentApprovals", () => {
  let applyMock: jest.Mock;
  let rejectMock: jest.Mock;
  let watchHandlers: {
    onNew?: (payload: unknown) => void;
    onUpdate?: (payload: unknown) => void;
  } = {};

  beforeEach(() => {
    applyMock = jest.fn(async () => ({ ok: true, data: { status: "applied", approvalId: previewId, previewId, result: null } }));
    rejectMock = jest.fn(async () => ({ ok: true, data: { ...approvalPayload, status: "rejected" } }));
    const approvals = {
      list: jest.fn(async () => ({ ok: true, data: { previews: [previewPayload], approvals: [approvalPayload] } })),
      apply: applyMock,
      applyWithContent: jest.fn(async () => ({ ok: true, data: { status: "applied", approvalId: previewId, previewId, result: null } })),
      reject: rejectMock,
      cancel: jest.fn(async () => ({ ok: true, data: null })),
      getRules: jest.fn(async () => ({ ok: true, data: [] })),
      setRules: jest.fn(async () => ({ ok: true, data: null })),
      watch: jest.fn((handlers) => {
        watchHandlers = handlers;
        return () => { watchHandlers = {}; };
      }),
    };
    const ipc = {
      invoke: jest.fn(async (channel: string) => {
        if (channel === '/prefs/get') {
          return { success: true, data: false };
        }
        if (channel === '/prefs/set') {
          return { success: true, data: true };
        }
        return { success: true };
      }) as InvokeFn,
      on: jest.fn(),
      removeListener: jest.fn(),
    };
    (window as Window & { electron?: any }).electron = { approvals, ipcRenderer: ipc };
    (window as Window & { __PF_USER__?: unknown }).__PF_USER__ = { displayName: "Tester" };
  });

  afterEach(() => {
    delete (window as Window & { electron?: unknown }).electron;
    delete (window as Window & { __PF_USER__?: unknown }).__PF_USER__;
    watchHandlers = {};
  });

  it("loads approvals when enabled and reflects list", async () => {
    const { result } = renderHook(() => useAgentApprovals({ sessionId, enabled: true }));

    await waitFor(() => {
      expect(result.current.approvals.length).toBe(1);
    });

    expect(result.current.approvals[0].summary).toContain("file write preview");
    expect(result.current.bypassEnabled).toBe(false);
  });

  it("removes pending item and tracks auto-approved updates", async () => {
    const { result } = renderHook(() => useAgentApprovals({ sessionId, enabled: true }));
    await waitFor(() => {
      expect(result.current.approvals.length).toBe(1);
    });

    await act(async () => {
      watchHandlers.onUpdate?.({
        type: "agent:approval:update",
        approval: { ...approvalPayload, status: "auto_approved", autoReason: "rule" },
      });
    });

    await waitFor(() => {
      expect(result.current.approvals.length).toBe(0);
      expect(result.current.autoApproved.length).toBe(1);
      expect(result.current.autoApproved[0].autoReason).toBe("rule");
    });
  });

  it("removes approval when update marks it resolved", async () => {
    const { result } = renderHook(() => useAgentApprovals({ sessionId, enabled: true }));
    await waitFor(() => {
      expect(result.current.approvals.length).toBe(1);
    });

    await act(async () => {
      watchHandlers.onUpdate?.({
        type: "agent:approval:update",
        approval: { ...approvalPayload, status: "applied" },
      });
    });

    await waitFor(() => {
      expect(result.current.approvals.length).toBe(0);
    });
  });

  it("sends resolvedBy value when approving", async () => {
    const { result } = renderHook(() => useAgentApprovals({ sessionId, enabled: true }));
    await waitFor(() => {
      expect(result.current.approvals.length).toBe(1);
    });

    await act(async () => {
      await result.current.approve(previewId, { feedbackText: "Looks good" });
    });

    expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({ resolvedBy: "Tester", feedbackText: "Looks good" }));
  });

  it("updates bypass preference via setBypass", async () => {
    const { result } = renderHook(() => useAgentApprovals({ sessionId, enabled: false }));
    await waitFor(() => {
      expect(typeof result.current.setBypass).toBe("function");
    });

    let success = false;
    await act(async () => {
      success = await result.current.setBypass(true);
    });

    expect(success).toBe(true);
    expect(result.current.bypassEnabled).toBe(true);
  });
});
