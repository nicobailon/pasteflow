import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ApplyResult, ServiceResult, StoredApproval, StoredPreview } from "../main/agent/approvals-service";
import type { ChatSessionId, PreviewId, ToolArgsSnapshot, ToolName, UnixMs } from "../main/agent/preview-registry";
import type { ApprovalStatus } from "../main/db/database-implementation";
import {
  deriveStreamingState,
  isPlainRecord,
  normalizeServiceResult,
  parseServiceError,
  parseStoredApproval,
  parseStoredPreview,
  type ServiceError,
  type StreamingState,
} from "../utils/approvals-parsers";

import useCurrentUserDisplayName from "./use-current-user-display-name";

type BridgeServiceResult<T> = ServiceResult<T>;

const BRIDGE_UNAVAILABLE_MESSAGE = "Approvals bridge unavailable";

type ApprovalWatchPayload =
  | { readonly type: "agent:approval:new"; readonly preview: unknown; readonly approval: unknown }
  | { readonly type: "agent:approval:update"; readonly approval: unknown }
  | { readonly type: "agent:auto_approval_cap_reached"; readonly sessionId: string; readonly cap: number; readonly count: number };

type ApprovalsBridge = {
  readonly list: (payload: { sessionId: string }) => Promise<unknown>;
  readonly apply: (payload: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }) => Promise<unknown>;
  readonly applyWithContent: (payload: { approvalId: string; content: unknown; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }) => Promise<unknown>;
  readonly reject: (payload: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown; resolvedBy?: string | null }) => Promise<unknown>;
  readonly cancel: (payload: { previewId: string }) => Promise<unknown>;
  readonly watch: (handlers: {
    readonly onNew?: (payload: ApprovalWatchPayload) => void;
    readonly onUpdate?: (payload: ApprovalWatchPayload) => void;
    readonly onEvent?: (payload: ApprovalWatchPayload) => void;
    readonly onReady?: (payload: unknown) => void;
    readonly onError?: (payload: unknown) => void;
  }) => () => void;
};

type PrefsInvoker = (channel: string, payload?: unknown) => Promise<unknown>;

type ToastVariant = "info" | "warning" | "error";

function emitApprovalsToast(message: string, variant: ToastVariant = "error"): void {
  if (!message) return;
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    const detail = Object.freeze({ message, variant });
    window.dispatchEvent(new CustomEvent('agent:approvals:toast', { detail }));
  } catch {
    // noop — toast channel best effort only
  }
}

export type ApprovalVm = Readonly<{
  id: string;
  previewId: PreviewId;
  sessionId: ChatSessionId;
  toolExecutionId: number;
  tool: ToolName;
  action: string;
  summary: string;
  detail: Readonly<Record<string, unknown>> | null;
  originalArgs: ToolArgsSnapshot;
  createdAt: number;
  hash: string;
  status: ApprovalStatus;
  autoReason: string | null;
  feedbackText: string | null;
  feedbackMeta: Readonly<Record<string, unknown>> | null;
  streaming: StreamingState;
}>;

type ReducerState = ReadonlyMap<string, ApprovalVm>;

type ReducerAction =
  | { readonly type: "reset"; readonly items: readonly ApprovalVm[] }
  | { readonly type: "upsert"; readonly item: ApprovalVm }
  | { readonly type: "remove"; readonly id: string };

interface UseAgentApprovalsOptions {
  readonly sessionId: string | null;
  readonly enabled: boolean;
}

interface UseAgentApprovalsResult {
  readonly approvals: readonly ApprovalVm[];
  readonly autoApproved: readonly ApprovalVm[];
  readonly approve: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<BridgeServiceResult<ApplyResult>>;
  readonly approveWithEdits: (approvalId: string, content: unknown, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<BridgeServiceResult<ApplyResult>>;
  readonly reject: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<BridgeServiceResult<StoredApproval>>;
  readonly cancel: (previewId: string) => Promise<BridgeServiceResult<null>>;
  readonly setBypass: (enabled: boolean) => Promise<boolean>;
  readonly bypassEnabled: boolean;
  readonly loading: boolean;
  readonly lastError: ServiceError | null;
}

function makeVm(preview: StoredPreview, approval: StoredApproval, overrideStreaming?: StreamingState): ApprovalVm {
  const streaming = overrideStreaming ?? deriveStreamingState(preview.detail ?? null);
  return Object.freeze({
    id: approval.id,
    previewId: preview.id,
    sessionId: preview.sessionId,
    toolExecutionId: preview.toolExecutionId,
    tool: preview.tool,
    action: preview.action,
    summary: preview.summary,
    detail: preview.detail,
    originalArgs: preview.originalArgs,
    createdAt: preview.createdAt,
    hash: preview.hash,
    status: approval.status,
    autoReason: approval.autoReason,
    feedbackText: approval.feedbackText,
    feedbackMeta: approval.feedbackMeta,
    streaming,
  });
}

function reducer(state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.type) {
    case "reset": {
      const next = new Map<string, ApprovalVm>();
      for (const item of action.items) {
        next.set(item.previewId as string, item);
      }
      return next as ReducerState;
    }
    case "upsert": {
      const next = new Map(state);
      next.set(action.item.previewId as string, action.item);
      return next as ReducerState;
    }
    case "remove": {
      if (!state.has(action.id)) return state;
      const next = new Map(state);
      next.delete(action.id);
      return next as ReducerState;
    }
    default: {
      return state;
    }
  }
}

function getApprovalsBridge(): ApprovalsBridge | null {
  const candidate = (window as unknown as { electron?: { approvals?: unknown } }).electron?.approvals;
  if (!candidate || !isPlainRecord(candidate)) return null;
  const required = ["list", "apply", "applyWithContent", "reject", "cancel", "watch"] as const;
  for (const key of required) {
    if (typeof candidate[key] !== "function") return null;
  }
  return candidate as ApprovalsBridge;
}

function getPrefsInvoker(): PrefsInvoker | null {
  const invoker = (window as unknown as { electron?: { ipcRenderer?: { invoke?: PrefsInvoker } } }).electron?.ipcRenderer?.invoke;
  return typeof invoker === "function" ? invoker : null;
}

function makeBridgeUnavailableResult<T>(): BridgeServiceResult<T> {
  return {
    ok: false as const,
    error: { code: "UNAVAILABLE", message: BRIDGE_UNAVAILABLE_MESSAGE },
  };
}

const AUTO_APPROVED_HISTORY_LIMIT = 5;

type AutoApprovedSetter = (value: readonly ApprovalVm[] | ((prev: readonly ApprovalVm[]) => readonly ApprovalVm[])) => void;

function toStoredPreview(vm: ApprovalVm): StoredPreview {
  return {
    id: vm.previewId,
    sessionId: vm.sessionId,
    toolExecutionId: vm.toolExecutionId,
    tool: vm.tool,
    action: vm.action,
    summary: vm.summary,
    detail: vm.detail,
    originalArgs: vm.originalArgs,
    createdAt: vm.createdAt as UnixMs,
    hash: vm.hash,
  };
}

function makeAutoApprovedVm(existing: ApprovalVm, approval: StoredApproval): ApprovalVm {
  return Object.freeze({
    ...existing,
    status: approval.status,
    autoReason: approval.autoReason,
    feedbackText: approval.feedbackText,
    feedbackMeta: approval.feedbackMeta,
  });
}

function buildApprovalCollections(previewsRaw: readonly unknown[], approvalsRaw: readonly unknown[]): {
  readonly pending: ApprovalVm[];
  readonly autoApproved: ApprovalVm[];
} {
  const previewMap = new Map<string, StoredPreview>();
  for (const previewValue of previewsRaw) {
    const preview = parseStoredPreview(previewValue);
    if (preview) {
      previewMap.set(preview.id as string, preview);
    }
  }
  const pending: ApprovalVm[] = [];
  const autoApproved: ApprovalVm[] = [];
  for (const approvalValue of approvalsRaw) {
    const approval = parseStoredApproval(approvalValue);
    if (!approval) {
      continue;
    }
    const preview = previewMap.get(approval.previewId as string);
    if (!preview) {
      continue;
    }
    if (approval.status === 'pending') {
      pending.push(makeVm(preview, approval));
      continue;
    }
    if (approval.status === 'auto_approved') {
      autoApproved.push(makeVm(preview, approval));
    }
  }
  return { pending, autoApproved };
}

function handleListResponse(
  response: unknown,
  handlers: {
    readonly dispatch: (action: ReducerAction) => void;
    readonly setAutoApproved: AutoApprovedSetter;
    readonly setLastError: (error: ServiceError | null) => void;
  },
): void {
  const parsed = normalizeServiceResult<{ previews: unknown; approvals: unknown }>(response);
  if (!parsed.ok) {
    handlers.setLastError(parsed.error);
    handlers.dispatch({ type: 'reset', items: [] });
    return;
  }
  const previewsRaw = Array.isArray(parsed.data?.previews) ? parsed.data.previews : [];
  const approvalsRaw = Array.isArray(parsed.data?.approvals) ? parsed.data.approvals : [];
  const { pending, autoApproved } = buildApprovalCollections(previewsRaw, approvalsRaw);
  handlers.dispatch({ type: 'reset', items: pending });
  handlers.setAutoApproved(autoApproved.length > 0 ? autoApproved : []);
  handlers.setLastError(null);
}

function handleListFailure(
  error: unknown,
  handlers: {
    readonly dispatch: (action: ReducerAction) => void;
    readonly setAutoApproved: AutoApprovedSetter;
    readonly setLastError: (error: ServiceError) => void;
  },
): void {
  const message = typeof (error as { message?: unknown })?.message === 'string'
    ? String((error as { message: string }).message)
    : 'Failed to load approvals';
  handlers.setLastError({ code: 'LIST_FAILED', message });
  handlers.dispatch({ type: 'reset', items: [] });
  handlers.setAutoApproved([]);
}

function handleNewApprovalEvent(
  payload: ApprovalWatchPayload | undefined,
  sessionId: string,
  dispatch: (action: ReducerAction) => void,
): void {
  if (!payload || payload.type !== 'agent:approval:new') return;
  const preview = parseStoredPreview((payload as { preview: unknown }).preview);
  const approval = parseStoredApproval((payload as { approval: unknown }).approval);
  if (!preview || !approval) return;
  if (preview.sessionId !== sessionId || approval.sessionId !== sessionId) return;
  if (approval.status !== 'pending') return;
  dispatch({ type: 'upsert', item: makeVm(preview, approval) });
}

function handleUpdateApprovalEvent(
  payload: ApprovalWatchPayload | undefined,
  sessionId: string,
  stateRef: { readonly current: ReducerState },
  dispatch: (action: ReducerAction) => void,
  setAutoApproved: AutoApprovedSetter,
): void {
  if (!payload || payload.type !== 'agent:approval:update') return;
  const approval = parseStoredApproval((payload as { approval: unknown }).approval);
  if (!approval || approval.sessionId !== sessionId) return;
  const existing = stateRef.current.get(approval.previewId as string);
  if (!existing) return;
  if (approval.status !== 'pending') {
    dispatch({ type: 'remove', id: approval.previewId as string });
    if (approval.status === 'auto_approved') {
      const autoVm = makeAutoApprovedVm(existing, approval);
      setAutoApproved((prev) => {
        const next = [autoVm, ...prev];
        return next.slice(0, AUTO_APPROVED_HISTORY_LIMIT);
      });
    }
    return;
  }
  const merged = makeVm(toStoredPreview(existing), approval, existing.streaming);
  dispatch({ type: 'upsert', item: merged });
}

function handleWatchErrorEvent(payload: unknown, setLastError: (error: ServiceError) => void): void {
  if (!payload) return;
  const err = isPlainRecord(payload) ? parseServiceError(payload) : { code: 'WATCH_FAILED', message: 'Approvals watch failed' };
  setLastError(err);
}

function handleWatchEvent(payload: ApprovalWatchPayload | unknown): void {
  if (!payload || !isPlainRecord(payload)) return;
  if ((payload as ApprovalWatchPayload).type === 'agent:auto_approval_cap_reached') {
    emitApprovalsToast('Auto-approve cap reached; further requests require manual approval.', 'info');
  }
}

function createWatchHandlers(params: {
  readonly sessionId: string;
  readonly dispatch: (action: ReducerAction) => void;
  readonly stateRef: { readonly current: ReducerState };
  readonly setAutoApproved: AutoApprovedSetter;
  readonly setLastError: (error: ServiceError) => void;
}): Parameters<ApprovalsBridge['watch']>[0] {
  return {
    onNew: (payload) => handleNewApprovalEvent(payload, params.sessionId, params.dispatch),
    onUpdate: (payload) => handleUpdateApprovalEvent(payload, params.sessionId, params.stateRef, params.dispatch, params.setAutoApproved),
    onEvent: (payload) => handleWatchEvent(payload),
    onError: (payload) => handleWatchErrorEvent(payload, params.setLastError),
  };
}

function parseBoolPreference(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (isPlainRecord(value) && "success" in value && (value as { success?: boolean }).success === true) {
    const data = (value as { data?: unknown }).data;
    if (typeof data === "boolean") return data;
    if (typeof data === "string") {
      const norm = data.trim().toLowerCase();
      if (norm === "true" || norm === "1" || norm === "yes") return true;
      if (norm === "false" || norm === "0" || norm === "no") return false;
    }
    return Boolean(data);
  }
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    if (norm === "true" || norm === "1" || norm === "yes") return true;
    if (norm === "false" || norm === "0" || norm === "no") return false;
  }
  return Boolean(value);
}

export default function useAgentApprovals(options: UseAgentApprovalsOptions): UseAgentApprovalsResult {
  const { sessionId, enabled } = options;
  const displayName = useCurrentUserDisplayName();
  const [state, dispatch] = useReducer(reducer, new Map<string, ApprovalVm>() as ReducerState);
  const [bypassEnabled, setBypassEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastError, setLastError] = useState<ServiceError | null>(null);
  const [autoApproved, setAutoApproved] = useState<readonly ApprovalVm[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<ReducerState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshBypass = useCallback(async () => {
    const invoke = getPrefsInvoker();
    if (!invoke) return false;
    try {
      const result = await invoke('/prefs/get', { key: 'agent.approvals.skipAll' });
      const next = parseBoolPreference(result);
      setBypassEnabled(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshBypass();
  }, [refreshBypass]);

  useEffect(() => {
    const electron = (window as unknown as { electron?: { ipcRenderer?: { on?: (channel: string, listener: (...args: unknown[]) => void) => void; removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void } } }).electron;
    const ipc = electron?.ipcRenderer;
    if (!ipc || typeof ipc.on !== "function") return () => {};
    const handler = () => { void refreshBypass(); };
    ipc.on('/prefs/get:update', handler);
    return () => {
      try {
        ipc.removeListener?.('/prefs/get:update', handler);
      } catch {
        // ignore cleanup errors
      }
    };
  }, [refreshBypass]);

  useEffect(() => {
    const bridge = getApprovalsBridge();
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    if (!enabled || !sessionId || !bridge) {
      dispatch({ type: 'reset', items: [] });
      setAutoApproved([]);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    bridge.list({ sessionId })
      .then((response) => {
        if (cancelled) return;
        handleListResponse(response, { dispatch, setAutoApproved, setLastError });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        handleListFailure(error, { dispatch, setAutoApproved, setLastError });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const stop = bridge.watch(
      createWatchHandlers({
        sessionId,
        dispatch,
        stateRef,
        setAutoApproved,
        setLastError,
      }),
    );
    stopRef.current = stop;

    return () => {
      cancelled = true;
      stop?.();
      stopRef.current = null;
    };
  }, [enabled, sessionId]);

  const approvals = useMemo(() => {
    const list = [...state.values()];
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [state]);

  const approve = useCallback(async (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      emitApprovalsToast(BRIDGE_UNAVAILABLE_MESSAGE);
      return makeBridgeUnavailableResult<ApplyResult>();
    }
    const { feedbackText, feedbackMeta } = options ?? {};
    const result = normalizeServiceResult<ApplyResult>(
      await bridge.apply({ approvalId, feedbackText, feedbackMeta, resolvedBy: displayName }),
    );
    if (!result.ok) {
      emitApprovalsToast(result.error.message ?? 'Failed to approve request');
    }
    return result;
  }, [displayName]);

  const approveWithEdits = useCallback(async (approvalId: string, content: unknown, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      emitApprovalsToast(BRIDGE_UNAVAILABLE_MESSAGE);
      return makeBridgeUnavailableResult<ApplyResult>();
    }
    const { feedbackText, feedbackMeta } = options ?? {};
    const result = normalizeServiceResult<ApplyResult>(
      await bridge.applyWithContent({
        approvalId,
        content,
        feedbackText,
        feedbackMeta,
        resolvedBy: displayName,
      }),
    );
    if (!result.ok) {
      emitApprovalsToast(result.error.message ?? 'Failed to approve with edits');
    }
    return result;
  }, [displayName]);

  const reject = useCallback(async (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      emitApprovalsToast(BRIDGE_UNAVAILABLE_MESSAGE);
      return makeBridgeUnavailableResult<StoredApproval>();
    }
    const { feedbackText, feedbackMeta } = options ?? {};
    const result = normalizeServiceResult<StoredApproval>(
      await bridge.reject({
        approvalId,
        feedbackText,
        feedbackMeta,
        resolvedBy: displayName,
      }),
    );
    if (!result.ok) {
      emitApprovalsToast(result.error.message ?? 'Failed to reject approval');
    }
    return result;
  }, [displayName]);

  const cancel = useCallback(async (previewId: string) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      emitApprovalsToast(BRIDGE_UNAVAILABLE_MESSAGE);
      return makeBridgeUnavailableResult<null>();
    }
    const result = normalizeServiceResult<null>(await bridge.cancel({ previewId }));
    if (!result.ok) {
      emitApprovalsToast(result.error.message ?? 'Failed to cancel preview');
    }
    return result;
  }, []);

  const setBypass = useCallback(async (next: boolean) => {
    const invoke = getPrefsInvoker();
    if (!invoke) return false;
    try {
      await invoke('/prefs/set', { key: 'agent.approvals.skipAll', value: next });
      setBypassEnabled(next);
      return true;
    } catch {
      return false;
    }
  }, []);


  return {
    approvals,
    approve,
    approveWithEdits,
    reject,
    cancel,
    setBypass,
    bypassEnabled,
    loading,
    lastError,
    autoApproved,
  };
}

export { type StreamingState } from "../utils/approvals-parsers";
