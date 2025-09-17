import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ApplyResult, AutoRule, ServiceResult, StoredApproval, StoredPreview } from "../main/agent/approvals-service";
import type { ChatSessionId, PreviewId, ToolArgsSnapshot, ToolName } from "../main/agent/preview-registry";
import type { ApprovalStatus } from "../main/db/database-implementation";
import {
  deriveStreamingState,
  isPlainRecord,
  normalizeServiceResult,
  parseServiceError,
  parseStoredApproval,
  parseStoredPreview,
  serializeAutoRule,
  type ServiceError,
  type StreamingState,
} from "../utils/approvals-parsers";

type BridgeServiceResult<T> = ServiceResult<T>;

type ApprovalWatchPayload =
  | { readonly type: "agent:approval:new"; readonly preview: unknown; readonly approval: unknown }
  | { readonly type: "agent:approval:update"; readonly approval: unknown };

type ApprovalsBridge = {
  readonly list: (payload: { sessionId: string }) => Promise<unknown>;
  readonly apply: (payload: { approvalId: string }) => Promise<unknown>;
  readonly applyWithContent: (payload: { approvalId: string; content: unknown }) => Promise<unknown>;
  readonly reject: (payload: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown }) => Promise<unknown>;
  readonly cancel: (payload: { previewId: string }) => Promise<unknown>;
  readonly getRules: () => Promise<unknown>;
  readonly setRules: (payload: { rules: readonly unknown[] }) => Promise<unknown>;
  readonly watch: (handlers: {
    readonly onNew?: (payload: ApprovalWatchPayload) => void;
    readonly onUpdate?: (payload: ApprovalWatchPayload) => void;
    readonly onReady?: (payload: unknown) => void;
    readonly onError?: (payload: unknown) => void;
  }) => () => void;
};

type PrefsInvoker = (channel: string, payload?: unknown) => Promise<unknown>;

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
  readonly approve: (approvalId: string) => Promise<BridgeServiceResult<ApplyResult>>;
  readonly approveWithEdits: (approvalId: string, content: unknown) => Promise<BridgeServiceResult<ApplyResult>>;
  readonly reject: (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => Promise<BridgeServiceResult<StoredApproval>>;
  readonly cancel: (previewId: string) => Promise<BridgeServiceResult<null>>;
  readonly setBypass: (enabled: boolean) => Promise<boolean>;
  readonly setRules: (rules: readonly AutoRule[]) => Promise<BridgeServiceResult<null>>;
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
  const required = ["list", "apply", "applyWithContent", "reject", "cancel", "getRules", "setRules", "watch"] as const;
  for (const key of required) {
    if (typeof candidate[key] !== "function") return null;
  }
  return candidate as ApprovalsBridge;
}

function getPrefsInvoker(): PrefsInvoker | null {
  const invoker = (window as unknown as { electron?: { ipcRenderer?: { invoke?: PrefsInvoker } } }).electron?.ipcRenderer?.invoke;
  return typeof invoker === "function" ? invoker : null;
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
  const [state, dispatch] = useReducer(reducer, new Map<string, ApprovalVm>() as ReducerState);
  const [bypassEnabled, setBypassEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastError, setLastError] = useState<ServiceError | null>(null);
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
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    bridge.list({ sessionId }).then((response) => {
      if (cancelled) return;
      const parsed = normalizeServiceResult<{ previews: unknown; approvals: unknown }>(response);
      if (!parsed.ok) {
        setLastError(parsed.error);
        dispatch({ type: 'reset', items: [] });
        return;
      }
      const previewsRaw = Array.isArray(parsed.data?.previews) ? parsed.data.previews : [];
      const approvalsRaw = Array.isArray(parsed.data?.approvals) ? parsed.data.approvals : [];
      const previewMap = new Map<string, StoredPreview>();
      for (const previewValue of previewsRaw) {
        const preview = parseStoredPreview(previewValue);
        if (preview) previewMap.set(preview.id as string, preview);
      }
      const items: ApprovalVm[] = [];
      for (const approvalValue of approvalsRaw) {
        const approval = parseStoredApproval(approvalValue);
        if (!approval) continue;
        if (approval.status !== 'pending') continue;
        const preview = previewMap.get(approval.previewId as string);
        if (!preview) continue;
        items.push(makeVm(preview, approval));
      }
      dispatch({ type: 'reset', items });
      setLastError(null);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = typeof (error as { message?: unknown })?.message === 'string'
        ? String((error as { message: string }).message)
        : 'Failed to load approvals';
      setLastError({ code: 'LIST_FAILED', message });
      dispatch({ type: 'reset', items: [] });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    const stop = bridge.watch({
      onNew: (payload) => {
        if (!payload || payload.type !== 'agent:approval:new') return;
        const preview = parseStoredPreview((payload as { preview: unknown }).preview);
        const approval = parseStoredApproval((payload as { approval: unknown }).approval);
        if (!preview || !approval || approval.status !== 'pending') return;
        dispatch({ type: 'upsert', item: makeVm(preview, approval) });
      },
      onUpdate: (payload) => {
        if (!payload || payload.type !== 'agent:approval:update') return;
        const approval = parseStoredApproval((payload as { approval: unknown }).approval);
        if (!approval) return;
        const existing = stateRef.current.get(approval.previewId as string);
        if (!existing) return;
        if (approval.status !== 'pending') {
          dispatch({ type: 'remove', id: approval.previewId as string });
          return;
        }
        const merged = makeVm({
          id: existing.previewId,
          sessionId: existing.sessionId,
          toolExecutionId: existing.toolExecutionId,
          tool: existing.tool,
          action: existing.action,
          summary: existing.summary,
          detail: existing.detail,
          originalArgs: existing.originalArgs,
          createdAt: existing.createdAt,
          hash: existing.hash,
        } as StoredPreview, approval, existing.streaming);
        dispatch({ type: 'upsert', item: merged });
      },
      onError: (payload) => {
        if (!payload) return;
        const err = isPlainRecord(payload) ? parseServiceError(payload) : { code: 'WATCH_FAILED', message: 'Approvals watch failed' };
        setLastError(err);
      },
    });
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

  const approve = useCallback(async (approvalId: string) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'Approvals bridge unavailable' } } as BridgeServiceResult<ApplyResult>;
    }
    const result = await bridge.apply({ approvalId });
    return normalizeServiceResult<ApplyResult>(result);
  }, []);

  const approveWithEdits = useCallback(async (approvalId: string, content: unknown) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'Approvals bridge unavailable' } } as BridgeServiceResult<ApplyResult>;
    }
    const result = await bridge.applyWithContent({ approvalId, content });
    return normalizeServiceResult<ApplyResult>(result);
  }, []);

  const reject = useCallback(async (approvalId: string, options?: { readonly feedbackText?: string; readonly feedbackMeta?: unknown }) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'Approvals bridge unavailable' } } as BridgeServiceResult<StoredApproval>;
    }
    const result = await bridge.reject({ approvalId, feedbackText: options?.feedbackText, feedbackMeta: options?.feedbackMeta });
    return normalizeServiceResult<StoredApproval>(result);
  }, []);

  const cancel = useCallback(async (previewId: string) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'Approvals bridge unavailable' } } as BridgeServiceResult<null>;
    }
    const result = await bridge.cancel({ previewId });
    return normalizeServiceResult<null>(result);
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

  const setRules = useCallback(async (rules: readonly AutoRule[]) => {
    const bridge = getApprovalsBridge();
    if (!bridge) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'Approvals bridge unavailable' } } as BridgeServiceResult<null>;
    }
    const serializedRules = Array.isArray(rules) ? rules.map((rule) => serializeAutoRule(rule)) : [];
    const result = await bridge.setRules({ rules: serializedRules });
    return normalizeServiceResult<null>(result);
  }, []);

  return {
    approvals,
    approve,
    approveWithEdits,
    reject,
    cancel,
    setBypass,
    setRules,
    bypassEnabled,
    loading,
    lastError,
  };
}

export { type StreamingState } from "../utils/approvals-parsers";
