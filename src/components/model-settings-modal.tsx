import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { X, Shield, CheckCircle2, Trash2, Copy } from "lucide-react";

import { estimateTokenCount } from "../utils/token-utils";

import AgentAlertBanner from "./agent-alert-banner";

import "./model-settings-modal.css";

import type { ToolName } from "../main/agent/preview-registry";
import { parseStoredApproval } from "../utils/approvals-parsers";

type ProviderId = "openai" | "anthropic" | "openrouter" | "groq";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  workspaceId?: string | null;
  initialTab?: ProviderId;
};

// Reused constants and helpers to reduce duplication
const IPC = { GET: "/prefs/get", SET: "/prefs/set" } as const;
const STRINGS = {
  enabled: "Enabled",
  disabled: "Disabled",
  copy: "Copy",
  reset: "Reset",
  useOnlyThisPrompt: "Use only this prompt",
  exportInMemory: "(export in memory)",
} as const;

const secondaryTextStyle: CSSProperties = { fontSize: 12, color: "var(--text-secondary)" };
const rowBetween: CSSProperties = { justifyContent: "space-between" };

type UsageRow = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; cost_usd: number | null };

const TOOL_OPTIONS: readonly ToolName[] = ["file", "edit", "terminal", "search", "context"] as const;

type ToolRuleDraft = { id: string; kind: "tool"; tool: ToolName; action: string };
type PathRuleDraft = { id: string; kind: "path"; pattern: string; tool: ToolName | "" };
type TerminalRuleDraft = { id: string; kind: "terminal"; commandIncludes: string };
type RuleDraft = ToolRuleDraft | PathRuleDraft | TerminalRuleDraft;

function makeRuleId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `rule-${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `rule-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_OPTIONS as readonly string[]).includes(value);
}

function normalizeRule(value: unknown): RuleDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind === "tool") {
    const toolValue = candidate.tool;
    if (!isToolName(toolValue)) return null;
    const rawAction = candidate.action;
    let action = "";
    if (typeof rawAction === "string") action = rawAction;
    else if (Array.isArray(rawAction)) action = rawAction.map(String).join(", ");
    return { id: makeRuleId(), kind: "tool", tool: toolValue, action };
  }
  if (kind === "path") {
    const pattern = typeof candidate.pattern === "string" ? candidate.pattern : "";
    if (!pattern) return null;
    const tool = isToolName(candidate.tool) ? candidate.tool : "";
    return { id: makeRuleId(), kind: "path", pattern, tool };
  }
  if (kind === "terminal") {
    const commandIncludes = typeof candidate.commandIncludes === "string" ? candidate.commandIncludes : "";
    return { id: makeRuleId(), kind: "terminal", commandIncludes };
  }
  return null;
}

function parseRulesResult(value: unknown): RuleDraft[] {
  const arr = Array.isArray(value) ? value : [];
  const drafts: RuleDraft[] = [];
  for (const item of arr) {
    const normalized = normalizeRule(item);
    if (normalized) drafts.push(normalized);
  }
  return drafts;
}

function ruleDraftToAutoRule(rule: RuleDraft): any {
  switch (rule.kind) {
    case "tool": {
      const trimmed = rule.action.trim();
      if (!trimmed) {
        return { kind: "tool", tool: rule.tool };
      }
      if (trimmed.includes(",")) {
        const parts = trimmed.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
        if (parts.length === 0) {
          return { kind: "tool", tool: rule.tool };
        }
        if (parts.length === 1) {
          return { kind: "tool", tool: rule.tool, action: parts[0] };
        }
        return { kind: "tool", tool: rule.tool, action: Object.freeze(parts) as readonly string[] };
      }
      return { kind: "tool", tool: rule.tool, action: trimmed };
    }
    case "path": {
      const base: { kind: "path"; pattern: string; tool?: ToolName } = { kind: "path", pattern: rule.pattern };
      if (rule.tool) base.tool = rule.tool;
      return base;
    }
    case "terminal": {
      const trimmed = rule.commandIncludes.trim();
      return trimmed ? { kind: "terminal", commandIncludes: trimmed } : { kind: "terminal" };
    }
    default: {
      return rule as never;
    }
  }
}

function summarizeUsage(rows: UsageRow[]) {
  let inSum = 0;
  let outSum = 0;
  let totalSum = 0;
  let latSum = 0;
  let latCount = 0;
  let costSum = 0;
  let costCount = 0;
  for (const r of rows) {
    inSum += r.input_tokens ?? 0;
    outSum += r.output_tokens ?? 0;
    totalSum += typeof r.total_tokens === "number" ? r.total_tokens : (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    if (typeof r.latency_ms === "number") { latSum += r.latency_ms; latCount += 1; }
    if (typeof r.cost_usd === "number" && Number.isFinite(r.cost_usd)) { costSum += r.cost_usd; costCount += 1; }
  }
  return {
    totalIn: inSum,
    totalOut: outSum,
    total: totalSum,
    avgLatency: latCount > 0 ? Math.round(latSum / latCount) : null,
    totalCost: costCount > 0 ? costSum : null,
  } as const;
}

function parseApprovalMode(v: unknown): 'never'|'risky'|'always'|null {
  const s = String(v ?? "").toLowerCase();
  return s === 'never' || s === 'risky' || s === 'always' ? (s as 'never'|'risky'|'always') : null;
}

function coerceNumberInRange(v: unknown, min: number, max: number): number | null {
  const n = Number((v as { data?: unknown })?.data ?? v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function coerceBoolean(value: unknown, fallback = false): boolean {
  const raw = (value as { data?: unknown })?.data ?? value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw > 0;
  if (typeof raw === "string") {
    const norm = raw.trim().toLowerCase();
    if (norm === "true" || norm === "1" || norm === "yes" || norm === "on") return true;
    if (norm === "false" || norm === "0" || norm === "no" || norm === "off") return false;
  }
  return fallback;
}

function defaultExecGlobalFromEnv(): boolean {
  try {
    const raw = String(process.env.PF_AGENT_DISABLE_EXECUTION_CONTEXT || "").trim().toLowerCase();
    const disabled = raw === "1" || raw === "true" || raw === "yes";
    return !disabled;
  } catch { return true; }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* noop: use fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch { /* noop */ }
}

// System prompt modes removed; replaced with simple Replace Summary toggles

function useApiInfo() {
  const info = window.__PF_API_INFO ?? {};
  const apiBase = typeof info.apiBase === "string" && info.apiBase ? info.apiBase : "http://localhost:5839";
  const authToken = typeof info.authToken === "string" ? info.authToken : "";
  return { apiBase, authToken } as const;
}

export default function ModelSettingsModal({ isOpen, onClose, sessionId, workspaceId, initialTab = "openai" }: Props) {
  const [tab, setTab] = useState<ProviderId>(initialTab);
  // Sync initial tab when modal opens or prop changes
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error" | "testing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<{ totalIn: number; totalOut: number; total: number; avgLatency: number | null; totalCost: number | null } | null>(null);

  // Auto-approval rules state
  const [autoRules, setAutoRules] = useState<RuleDraft[]>([]);
  const [autoRulesLoading, setAutoRulesLoading] = useState<boolean>(false);
  const [autoRulesError, setAutoRulesError] = useState<string | null>(null);
  const [autoRulesDirty, setAutoRulesDirty] = useState<boolean>(false);
  const [autoRulesStatus, setAutoRulesStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [autoCap, setAutoCap] = useState<number>(5);
  const [autoCapDirty, setAutoCapDirty] = useState<boolean>(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [initialNotificationsEnabled, setInitialNotificationsEnabled] = useState<boolean>(false);
  const [notificationsDirty, setNotificationsDirty] = useState<boolean>(false);
  const [newRuleKind, setNewRuleKind] = useState<RuleDraft["kind"]>("tool");
  const [newRuleTool, setNewRuleTool] = useState<ToolName>("edit");
  const [newRuleAction, setNewRuleAction] = useState<string>("");
  const [newRulePattern, setNewRulePattern] = useState<string>("");
  const [newRulePathTool, setNewRulePathTool] = useState<string>("");
  const [newRuleCommandIncludes, setNewRuleCommandIncludes] = useState<string>("");
  const [newRuleError, setNewRuleError] = useState<string | null>(null);
  const [approvalCounts, setApprovalCounts] = useState<{ total: number; pending: number } | null>(null);

  // OpenAI
  const [openaiInput, setOpenaiInput] = useState("");
  const [openaiStored, setOpenaiStored] = useState<boolean>(false);

  // Anthropic
  const [anthropicInput, setAnthropicInput] = useState("");
  const [anthropicStored, setAnthropicStored] = useState<boolean>(false);

  // OpenRouter
  const [openrouterInput, setOpenrouterInput] = useState("");
  const [openrouterStored, setOpenrouterStored] = useState<boolean>(false);
  const [openrouterBaseUrl, setOpenrouterBaseUrl] = useState("https://openrouter.ai/api/v1");

  // Groq
  const [groqInput, setGroqInput] = useState("");
  const [groqStored, setGroqStored] = useState<boolean>(false);

  // General config
  const [temperature, setTemperature] = useState<number>(0.3);
  const [maxOut, setMaxOut] = useState<number>(4000);
  const [enableWrites, setEnableWrites] = useState<boolean>(true);
  const [enableExec, setEnableExec] = useState<boolean>(true);
  const [approvalMode, setApprovalMode] = useState<'never'|'risky'|'always'>('risky');
  const [execCtxGlobalEnabled, setExecCtxGlobalEnabled] = useState<boolean>(true);
  const [execCtxWorkspaceEnabled, setExecCtxWorkspaceEnabled] = useState<boolean>(true);
  // UI: reasoning visibility default (global)
  const [reasoningDefaultCollapsed, setReasoningDefaultCollapsed] = useState<boolean>(false);

  // System prompts: separate global and workspace
  const [spGlobalText, setSpGlobalText] = useState<string>("");
  const [spGlobalReplace, setSpGlobalReplace] = useState<boolean>(false);
  const [spWorkspaceText, setSpWorkspaceText] = useState<string>("");
  const [spWorkspaceReplace, setSpWorkspaceReplace] = useState<boolean>(false);
  // Tools help is always included server-side; no toggle in UI.
  const [_maxCtxTokens, setMaxCtxTokens] = useState<number>(120_000);

  // Tools enable/disable (per tool)
  type ToolToggle = { name: string; description: string; enabled: boolean };
  const [toolToggles, setToolToggles] = useState<ToolToggle[]>([]);

  const { apiBase, authToken } = useApiInfo();

  useEffect(() => {
    let mounted = true;
    if (!isOpen) {
      return () => { mounted = false; };
    }
    setAutoRulesLoading(true);
    (async () => {
      try {
        const [okey, akey, orKey, orBase, groqKey, temp, max, w, x, appr, maxCtx, execCtx, execCtxWs, rsnDefault] = await Promise.all([
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'integrations.openai.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'integrations.anthropic.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'integrations.openrouter.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'integrations.openrouter.baseUrl' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'integrations.groq.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.temperature' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.maxOutputTokens' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.enableFileWrite' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.enableCodeExecution' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.approvalMode' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.maxContextTokens' }),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.executionContext.enabled' }),
          workspaceId ? window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: `agent.executionContext.enabled.${workspaceId}` }) : Promise.resolve(null),
          window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'ui.reasoning.defaultCollapsed' }),
        ] as const);
        if (mounted === false) return;
        setOpenaiStored(Boolean(okey?.data));
        setAnthropicStored(Boolean(akey?.data));
        setOpenrouterStored(Boolean(orKey?.data));
        setGroqStored(Boolean(groqKey?.data));
        if (typeof orBase?.data === 'string' && orBase.data.trim()) setOpenrouterBaseUrl(orBase.data);
        const t = coerceNumberInRange(temp, 0, 2);
        if (t != null) setTemperature(t);
        const m = coerceNumberInRange(max, 1, 128_000);
        if (m != null) setMaxOut(m);
        setEnableWrites(Boolean(w?.data ?? true));
        setEnableExec(Boolean(x?.data ?? true));
        const am = parseApprovalMode((appr as any)?.data);
        if (am) setApprovalMode(am);
        setReasoningDefaultCollapsed(Boolean(rsnDefault?.data));
        const mc = coerceNumberInRange(maxCtx, 1000, 2_000_000);
        if (mc != null) setMaxCtxTokens(mc);
        const storedExecGlobal = execCtx?.data;
        if (typeof storedExecGlobal === 'boolean') setExecCtxGlobalEnabled(storedExecGlobal);
        else setExecCtxGlobalEnabled(defaultExecGlobalFromEnv());
        const storedExecWs = (execCtxWs as any)?.data;
        if (typeof storedExecWs === 'boolean') setExecCtxWorkspaceEnabled(storedExecWs);

        const approvalsApi = window.electron?.approvals;
        let rulesResult: unknown = { ok: true, data: [] } as const;
        try {
          if (approvalsApi?.getRules) {
            rulesResult = await approvalsApi.getRules();
          }
        } catch (error) {
          if (mounted) {
            setAutoRulesError((error as Error)?.message || 'Failed to load auto-approval rules');
          }
        }

        const [capPref, notifyPref] = await Promise.all([
          (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.approvals.autoCap' }).catch(() => null),
          (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.approvals.notifications' }).catch(() => null),
        ]);

        if (mounted === false) return;
        const rulesOk = typeof rulesResult === 'object' && rulesResult && (rulesResult as { ok?: boolean }).ok === true;
        const parsedRules = rulesOk
          ? parseRulesResult((rulesResult as { data?: unknown }).data)
          : [];
        setAutoRules(parsedRules);
        setAutoRulesDirty(false);
        setAutoRulesStatus('idle');
        if (rulesOk) {
          setAutoRulesError(null);
        } else {
          const message = typeof (rulesResult as { error?: { message?: string } }).error?.message === 'string'
            ? (rulesResult as { error: { message: string } }).error.message
            : 'Failed to load auto-approval rules';
          setAutoRulesError(message);
        }

        const capValue = coerceNumberInRange(capPref, 0, 50);
        if (typeof capValue === 'number') {
          setAutoCap(capValue);
        } else {
          setAutoCap(5);
        }
        setAutoCapDirty(false);

        const notifyValue = coerceBoolean(notifyPref, false);
        setNotificationsEnabled(notifyValue);
        setInitialNotificationsEnabled(notifyValue);
        setNotificationsDirty(false);
      } catch {
        // ignore general load errors; specific sections handle their own fallbacks
      } finally {
        if (mounted) {
          setAutoRulesLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [isOpen, workspaceId]);

  const handleRemoveRule = (id: string) => {
    setAutoRules((prev) => prev.filter((rule) => rule.id !== id));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleRuleToolChange = (id: string, value: string) => {
    if (!isToolName(value)) return;
    setAutoRules((prev) => prev.map((rule) => (rule.id === id && rule.kind === 'tool') ? { ...rule, tool: value } : rule));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleRuleActionChange = (id: string, value: string) => {
    setAutoRules((prev) => prev.map((rule) => (rule.id === id && rule.kind === 'tool') ? { ...rule, action: value } : rule));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleRulePatternChange = (id: string, value: string) => {
    setAutoRules((prev) => prev.map((rule) => (rule.id === id && rule.kind === 'path') ? { ...rule, pattern: value } : rule));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleRulePathToolChange = (id: string, value: string) => {
    const nextTool = isToolName(value) ? value : "";
    setAutoRules((prev) => prev.map((rule) => (rule.id === id && rule.kind === 'path') ? { ...rule, tool: nextTool } : rule));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleRuleCommandIncludesChange = (id: string, value: string) => {
    setAutoRules((prev) => prev.map((rule) => (rule.id === id && rule.kind === 'terminal') ? { ...rule, commandIncludes: value } : rule));
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const resetNewRuleForm = () => {
    setNewRuleTool('edit');
    setNewRuleAction("");
    setNewRulePattern("");
    setNewRulePathTool("");
    setNewRuleCommandIncludes("");
    setNewRuleError(null);
  };

  const handleAddRule = () => {
    setNewRuleError(null);
    if (newRuleKind === 'tool') {
      if (!isToolName(newRuleTool)) {
        setNewRuleError('Select a tool for the rule');
        return;
      }
      const draft: ToolRuleDraft = { id: makeRuleId(), kind: 'tool', tool: newRuleTool, action: newRuleAction.trim() };
      setAutoRules((prev) => [...prev, draft]);
    } else if (newRuleKind === 'path') {
      const pattern = newRulePattern.trim();
      if (!pattern) {
        setNewRuleError('Path pattern is required');
        return;
      }
      const tool = isToolName(newRulePathTool) ? newRulePathTool : "";
      const draft: PathRuleDraft = { id: makeRuleId(), kind: 'path', pattern, tool };
      setAutoRules((prev) => [...prev, draft]);
    } else {
      const commandIncludes = newRuleCommandIncludes.trim();
      if (!commandIncludes) {
        setNewRuleError('Command filter is required');
        return;
      }
      const draft: TerminalRuleDraft = { id: makeRuleId(), kind: 'terminal', commandIncludes };
      setAutoRules((prev) => [...prev, draft]);
    }
    setAutoRulesDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
    resetNewRuleForm();
  };

  const handleCapChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    setAutoCap(Number.isFinite(value) ? value : 0);
    setAutoCapDirty(true);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  };

  const handleNotificationsChange = useCallback((next: boolean) => {
    setNotificationsEnabled(next);
    setNotificationsDirty(next !== initialNotificationsEnabled);
    setAutoRulesStatus('idle');
    setAutoRulesError(null);
  }, [initialNotificationsEnabled]);

  const renderRuleFields = (rule: RuleDraft): JSX.Element => {
    if (rule.kind === 'tool') {
      return (
        <div className="auto-rules-fields">
          <label>
            <span>Tool</span>
            <select value={rule.tool} onChange={(event) => handleRuleToolChange(rule.id, event.currentTarget.value)}>
              {TOOL_OPTIONS.map((tool) => (
                <option key={tool} value={tool}>{tool}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Actions (optional)</span>
            <input value={rule.action} onChange={(event) => handleRuleActionChange(rule.id, event.currentTarget.value)} placeholder="write, diff" />
          </label>
        </div>
      );
    }
    if (rule.kind === 'path') {
      return (
        <div className="auto-rules-fields">
          <label>
            <span>Pattern</span>
            <input value={rule.pattern} onChange={(event) => handleRulePatternChange(rule.id, event.currentTarget.value)} placeholder="tests/" />
          </label>
          <label>
            <span>Tool filter</span>
            <select value={rule.tool} onChange={(event) => handleRulePathToolChange(rule.id, event.currentTarget.value)}>
              <option value="">Any tool</option>
              {TOOL_OPTIONS.map((tool) => (
                <option key={tool} value={tool}>{tool}</option>
              ))}
            </select>
          </label>
        </div>
      );
    }
    return (
      <div className="auto-rules-fields">
        <label>
          <span>Command contains</span>
          <input value={rule.commandIncludes} onChange={(event) => handleRuleCommandIncludesChange(rule.id, event.currentTarget.value)} placeholder="npm test" />
        </label>
      </div>
    );
  };

  const handleSaveRules = async () => {
    setAutoRulesStatus('saving');
    const invalid = autoRules.find((rule) => (
      (rule.kind === 'path' && !rule.pattern.trim()) ||
      (rule.kind === 'terminal' && !rule.commandIncludes.trim())
    ));
    if (invalid) {
      setAutoRulesStatus('error');
      setAutoRulesError(invalid.kind === 'path' ? 'Path rules require a pattern' : 'Terminal rules require a command filter');
      return;
    }
    try {
      const approvalsApi = window.electron?.approvals;
      const prefsInvoker = window.electron?.ipcRenderer?.invoke;
      if (!approvalsApi?.setRules) {
        throw new Error('Approvals API unavailable');
      }
      const serializedRules = autoRules.map((rule) => {
        const base = ruleDraftToAutoRule(rule);
        if (base.kind === 'tool' && Array.isArray(base.action)) {
          return { ...base, action: [...base.action] };
        }
        return { ...base };
      });
      const capped = Math.max(0, Math.min(50, Math.round(autoCap)));
      const result = await approvalsApi.setRules({ rules: serializedRules, autoCap: capped });
      if (!result || typeof result !== 'object' || (result as { ok?: boolean }).ok !== true) {
        const message = typeof (result as { error?: { message?: string } }).error?.message === 'string'
          ? (result as { error: { message: string } }).error.message
          : 'Failed to save auto-approval rules';
        throw new Error(message);
      }

      if (notificationsDirty) {
        if (typeof prefsInvoker !== 'function') {
          throw new TypeError('Preferences API unavailable');
        }
        await prefsInvoker(IPC.SET, { key: 'agent.approvals.notifications', value: notificationsEnabled });
      }

      setAutoCap(capped);
      setAutoRulesDirty(false);
      setAutoCapDirty(false);
      setInitialNotificationsEnabled(notificationsEnabled);
      setNotificationsDirty(false);
      setAutoRulesStatus('success');
      setAutoRulesError(null);
      setTimeout(() => { setAutoRulesStatus('idle'); }, 1200);
    } catch (error_) {
      setAutoRulesStatus('error');
      setAutoRulesError((error_ as Error)?.message || 'Failed to save auto-approval rules');
    }
  };

  useEffect(() => {
    if (!isOpen || !sessionId) {
      setApprovalCounts(null);
      return;
    }
    const approvalsApi = (window as any).electron?.approvals;
    if (!approvalsApi?.list) {
      setApprovalCounts(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response: unknown = await approvalsApi.list({ sessionId });
        if (cancelled) return;
        const result = typeof response === 'object' && response !== null ? response as { ok?: boolean; data?: unknown } : null;
        if (!result || result.ok !== true) {
          setApprovalCounts(null);
          return;
        }
        const approvalsRaw = Array.isArray((result.data as { approvals?: unknown[] } | undefined)?.approvals)
          ? (result.data as { approvals: unknown[] }).approvals
          : [];
        let total = 0;
        let pending = 0;
        for (const item of approvalsRaw) {
          const approval = parseStoredApproval(item);
          if (!approval) continue;
          total += 1;
          if (approval.status === 'pending') pending += 1;
        }
        setApprovalCounts({ total, pending });
      } catch {
        if (!cancelled) setApprovalCounts(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, sessionId]);

  const canSave = status !== 'saving' && status !== 'testing';

  // Load session usage stats when opened
  useEffect(() => {
    (async () => {
      try {
        if (!isOpen || !sessionId) { setUsageStats(null); return; }
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
        if (res && res.success && Array.isArray(res.data)) {
          const rows = res.data as UsageRow[];
          const stats = summarizeUsage(rows);
          setUsageStats(stats);
          try { console.log('[UI][Telemetry] settings: usage stats', { sessionId, rows: rows.length, totalIn: stats.totalIn, totalOut: stats.totalOut, total: stats.total, avgLatency: stats.avgLatency }); } catch { /* noop */ }
        } else {
          setUsageStats(null);
          try { console.log('[UI][Telemetry] settings: no usage stats', { sessionId, res }); } catch { /* noop */ }
        }
      } catch { setUsageStats(null); }
    })();
  }, [isOpen, sessionId]);

  // Load tool catalog + enabled flags for toggles
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        if (!isOpen) return;
        const res = await fetch(`${apiBase}/api/v1/tools`, { headers: { Authorization: authToken ? `Bearer ${authToken}` : '' } });
        const json = await res.json();
        const tools: { name: string; description: string }[] = Array.isArray(json?.data?.tools) ? json.data.tools : [];
        const enabledRec: Record<string, boolean> = (json?.data?.enabled && typeof json.data.enabled === 'object') ? json.data.enabled : {};
        const list: ToolToggle[] = tools.map((t) => ({ name: t.name, description: t.description, enabled: enabledRec[t.name] !== false }));
        if (!aborted) setToolToggles(list);
      } catch {
        // Fallback to known tools if API is not ready
        if (!aborted) setToolToggles([
          { name: 'file', description: 'File operations', enabled: true },
          { name: 'search', description: 'Code search', enabled: true },
          { name: 'edit', description: 'Editing utilities', enabled: true },
          { name: 'context', description: 'Context utilities', enabled: true },
          { name: 'terminal', description: 'Terminal control', enabled: true },
        ]);
      }
    })();
    return () => { aborted = true; };
  }, [isOpen, apiBase, authToken]);

  // Load system prompt preferences (global + workspace)
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      try {
        const globalReplaceP = (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.systemPrompt.replace' });
        const globalTextP = (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.systemPrompt.text' });
        const wsReplaceP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: `agent.systemPrompt.replace.${workspaceId}` }) : Promise.resolve(null);
        const wsTextP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.(IPC.GET, { key: `agent.systemPrompt.text.${workspaceId}` }) : Promise.resolve(null);
        const [gReplace, gText, wReplace, wText] = await Promise.all([globalReplaceP, globalTextP, wsReplaceP, wsTextP] as const);
        if (mounted === false) return;
        const grRaw = typeof gReplace?.data === 'boolean' ? gReplace.data : false;
        const gtRaw = typeof gText?.data === 'string' ? gText.data : '';
        const wrRaw = typeof (wReplace as any)?.data === 'boolean' ? (wReplace as any).data : false;
        const wtRaw = typeof (wText as any)?.data === 'string' ? (wText as any).data : '';
        setSpGlobalReplace(Boolean(grRaw));
        setSpGlobalText(typeof gtRaw === 'string' ? gtRaw : '');
        setSpWorkspaceReplace(Boolean(wrRaw));
        setSpWorkspaceText(typeof wtRaw === 'string' ? wtRaw : '');
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [isOpen, workspaceId]);

  // Derived counts and warnings per prompt
  const spGlobalCharCount = spGlobalText.length;
  const spGlobalTokenCount = useMemo<number>(() => estimateTokenCount(spGlobalText), [spGlobalText]);
  const spWorkspaceCharCount = spWorkspaceText.length;
  const spWorkspaceTokenCount = useMemo<number>(() => estimateTokenCount(spWorkspaceText), [spWorkspaceText]);
  // No combined warning for prompts; individual sizes are shown next to editors.

  // previewText no longer needed; the editor shows the effective prompt directly.

  async function saveKey(key: string, value: string | null, enc = true) {
    setStatus('saving');
    setError(null);
    try {
      await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key, value, encrypted: enc });
      // Optimistically update local stored-state indicators so UI reflects changes immediately
      try {
        const truthy = Boolean(value && String(value).trim());
        switch (key) {
          case 'integrations.openai.apiKey': {
            setOpenaiStored(truthy);
            if (!truthy) setOpenaiInput("");
            break;
          }
          case 'integrations.anthropic.apiKey': {
            setAnthropicStored(truthy);
            if (!truthy) setAnthropicInput("");
            break;
          }
          case 'integrations.openrouter.apiKey': {
            setOpenrouterStored(truthy);
            if (!truthy) setOpenrouterInput("");
            break;
          }
          case 'integrations.groq.apiKey': {
            setGroqStored(truthy);
            if (!truthy) setGroqInput("");
            break;
          }
          case 'integrations.openrouter.baseUrl': {
            if (typeof value === 'string') setOpenrouterBaseUrl(value);
            break;
          }
          default: {
            break;
          }
        }
      } catch { /* noop */ }
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1000);
    } catch (error) {
      setStatus('error');
      setError((error as Error)?.message || 'Failed to save');
    }
  }

  async function testProvider(provider: ProviderId) {
    setStatus('testing');
    setError(null);
    try {
      // Use current default model for provider
      const modelPref: unknown = await window.electron?.ipcRenderer?.invoke?.(IPC.GET, { key: 'agent.defaultModel' });
      const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
      const model = (isObj(modelPref) && (modelPref as Record<string, unknown>)['success'] === true && typeof (modelPref as { data?: unknown }).data === 'string')
        ? (modelPref as { data: string }).data
        : 'gpt-4o-mini';
      const body: Record<string, unknown> = { provider, model, temperature: 0, maxOutputTokens: 1 };
      if (provider === 'openai') body.apiKey = openaiInput || undefined;
      if (provider === 'anthropic') body.apiKey = anthropicInput || undefined;
      if (provider === 'openrouter') { body.apiKey = openrouterInput || undefined; body.baseUrl = openrouterBaseUrl || undefined; }
      if (provider === 'groq') body.apiKey = groqInput || undefined;
      const resp = await fetch(`${apiBase}/api/v1/models/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      const ok = json?.data?.ok === true || json?.ok === true;
      if (!ok) throw new Error(json?.data?.error || json?.error || 'Validation failed');
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1000);
    } catch (error) {
      setStatus('error');
      setError((error as Error)?.message || 'Validation failed');
    }
  }

  let newRuleFields: JSX.Element;
  if (newRuleKind === 'tool') {
    newRuleFields = (
      <>
        <label>
          <span>Tool</span>
          <select value={newRuleTool} onChange={(event) => { const value = event.currentTarget.value as ToolName; setNewRuleTool(isToolName(value) ? value : 'edit'); }}>
            {TOOL_OPTIONS.map((tool) => (
              <option key={tool} value={tool}>{tool}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Actions (optional)</span>
          <input value={newRuleAction} onChange={(event) => setNewRuleAction(event.currentTarget.value)} placeholder="write, diff" />
        </label>
      </>
    );
  } else if (newRuleKind === 'path') {
    newRuleFields = (
      <>
        <label>
          <span>Pattern</span>
          <input value={newRulePattern} onChange={(event) => setNewRulePattern(event.currentTarget.value)} placeholder="src/tests/" />
        </label>
        <label>
          <span>Tool filter</span>
          <select value={newRulePathTool} onChange={(event) => setNewRulePathTool(event.currentTarget.value)}>
            <option value="">Any tool</option>
            {TOOL_OPTIONS.map((tool) => (
              <option key={tool} value={tool}>{tool}</option>
            ))}
          </select>
        </label>
      </>
    );
  } else {
    newRuleFields = (
      <label>
        <span>Command contains</span>
        <input value={newRuleCommandIncludes} onChange={(event) => setNewRuleCommandIncludes(event.currentTarget.value)} placeholder="npm run lint" />
      </label>
    );
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content workspace-modal model-settings-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Agent Settings</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="modal-body">
            <div className="integrations-note">
              <Shield size={16} />
              <div className="integrations-note-text">API keys are stored encrypted and used only locally.</div>
            </div>

            <div className="settings-tabs">
              <button className={`tab-button ${tab === 'openai' ? 'active' : ''}`} onClick={() => setTab('openai')}>OpenAI</button>
              <button className={`tab-button ${tab === 'anthropic' ? 'active' : ''}`} onClick={() => setTab('anthropic')}>Anthropic</button>
              <button className={`tab-button ${tab === 'openrouter' ? 'active' : ''}`} onClick={() => setTab('openrouter')}>OpenRouter</button>
              <button className={`tab-button ${tab === 'groq' ? 'active' : ''}`} onClick={() => setTab('groq')}>Groq</button>
            </div>

            {tab === 'openai' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="openai-key">OpenAI API key</label>
                    {openaiStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {openaiStored ? (
                    <div className="actions" style={rowBetween}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-••••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.openai.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="openai-key" type="password" placeholder="sk-..." value={openaiInput} onChange={(e) => setOpenaiInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !openaiInput.trim()} onClick={() => saveKey('integrations.openai.apiKey', openaiInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openai')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {tab === 'anthropic' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="anthropic-key">Anthropic API key</label>
                    {anthropicStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {anthropicStored ? (
                    <div className="actions" style={rowBetween}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-ant-••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.anthropic.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="anthropic-key" type="password" placeholder="sk-ant-..." value={anthropicInput} onChange={(e) => setAnthropicInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !anthropicInput.trim()} onClick={() => saveKey('integrations.anthropic.apiKey', anthropicInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('anthropic')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {tab === 'openrouter' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="openrouter-key">OpenRouter API key</label>
                    {openrouterStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {openrouterStored ? (
                    <div className="actions" style={rowBetween}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-or-••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.openrouter.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="openrouter-key" type="password" placeholder="sk-or-v1-..." value={openrouterInput} onChange={(e) => setOpenrouterInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !openrouterInput.trim()} onClick={() => saveKey('integrations.openrouter.apiKey', openrouterInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openrouter')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="openrouter-base">Base URL</label>
                  <input id="openrouter-base" type="text" placeholder="https://openrouter.ai/api/v1" value={openrouterBaseUrl} onChange={(e) => setOpenrouterBaseUrl(e.target.value)} />
                  <div className="actions right">
                    <button className="secondary" disabled={!canSave} onClick={() => saveKey('integrations.openrouter.baseUrl', openrouterBaseUrl.trim(), false)}>Save Base URL</button>
                  </div>
                </div>
              </section>
            )}

            {tab === 'groq' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="groq-key">Groq API key</label>
                    {groqStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {groqStored ? (
                    <div className="actions" style={rowBetween}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>gsk_••••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.groq.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="groq-key" type="password" placeholder="gsk_..." value={groqInput} onChange={(e) => setGroqInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !groqInput.trim()} onClick={() => saveKey('integrations.groq.apiKey', groqInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('groq')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="help" style={{ ...secondaryTextStyle, marginTop: 8 }}>
                  Supports Kimi K2 0905 model with 16K output tokens and 262K context window.
                </div>
              </section>
            )}

            <section className="settings-section">
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="temperature-input">Temperature</label>
                  <input id="temperature-input" type="number" step={0.1} min={0} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="max-output-input">Max output tokens</label>
                  <input id="max-output-input" type="number" min={1} max={128_000} value={maxOut} onChange={(e) => setMaxOut(Number(e.target.value))} />
                </div>
              </div>
            </section>

            <section className="settings-section">
              {(() => {
                const human = (() => {
                  switch (approvalMode) {
                    case 'always': { return 'Always'; }
                    case 'never': { return 'Never'; }
                    default: { return 'Risky only'; }
                  }
                })();
                const desc = (() => {
                  switch (approvalMode) {
                    case 'always': { return 'All terminal commands and apply operations require approval.'; }
                    case 'never': { return 'No approval required for terminal commands or apply operations.'; }
                    default: { return 'Approval required for known dangerous terminal commands; safe actions run without prompts.'; }
                  }
                })();
                return (
                  <AgentAlertBanner
                    variant="info"
                    message={
                      <span>
                        <strong>Approval mode:</strong> {human}. {desc}
                      </span>
                    }
                  />
                );
              })()}
              <div className="settings-grid">
                <div className="field">
                  <label>
                    <input type="checkbox" checked={enableWrites} onChange={(e) => setEnableWrites(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Enable file writes</span>
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={enableExec} onChange={(e) => setEnableExec(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Enable code execution (terminal)</span>
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={reasoningDefaultCollapsed} onChange={(e) => setReasoningDefaultCollapsed(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Collapse reasoning by default</span>
                  </label>
                  <div className="help" style={{ ...secondaryTextStyle, marginTop: 4 }}>
                    Controls whether assistant reasoning is hidden by default. You can still Show/Hide per message.
                  </div>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={execCtxGlobalEnabled} onChange={(e) => setExecCtxGlobalEnabled(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Include System Execution Context (Global)</span>
                  </label>
                  <div className="help" style={{ ...secondaryTextStyle, marginTop: 4 }}>
                    Adds a short, automatic snapshot to the system prompt so the agent understands your environment (paths, OS, shell, time).
                    <div style={{ marginTop: 4 }}>Example:</div>
                    <pre style={{ margin: '6px 0 0', padding: 6, background: 'var(--surface-muted)', borderRadius: 4, fontSize: 11 }}>
- Working Directory: /your/project
- Home Directory: /Users/you
- Platform: darwin (arm64)
- Shell: zsh 5.9
- Timestamp: 2025-09-10T12:34:56.789Z
                    </pre>
                  </div>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={execCtxWorkspaceEnabled} onChange={(e) => setExecCtxWorkspaceEnabled(e.target.checked)} disabled={!workspaceId} />
                    <span style={{ marginLeft: 6 }}>Include System Execution Context (Workspace)</span>
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="approval-mode">Approval mode</label>
                  <select id="approval-mode" value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as 'never'|'risky'|'always')}>
                    <option value="never">Never</option>
                    <option value="risky">Risky only</option>
                    <option value="always">Always</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Tools enable/disable */}
            {toolToggles.length > 0 && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <div className="field-label">Tools</div>
                  </div>
                  <div className="settings-grid">
                    {toolToggles.map((t, idx) => (
                      <div key={t.name} className="field" style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 500 }}>{t.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.description}</div>
                          </div>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={t.enabled}
                              onChange={async (e) => {
                                const next = e.target.checked;
                                setToolToggles((prev) => prev.map((p, i) => i === idx ? { ...p, enabled: next } : p));
                                try { await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: `agent.tools.${t.name}.enabled`, value: next }); } catch { /* ignore */ }
                              }}
                            />
                            <span style={{ fontSize: 12 }}>{t.enabled ? 'Enabled' : 'Disabled'}</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* System Prompts section */}
            <section className="settings-section">
              <div className="field">
                <div className="field-label-row">
                  <div className="field-label">Global System Prompt</div>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>
                      <input type="checkbox" checked={spGlobalReplace} onChange={(e) => setSpGlobalReplace(e.target.checked)} />
                      <span style={{ marginLeft: 6 }}>Use only this prompt</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="system-prompt-text-global">Global prompt</label>
                <div className="help" style={{ ...secondaryTextStyle, marginTop: 4 }}>
                  Leave empty to skip. When not replacing, Global and Workspace prompts are combined.
                </div>
                <textarea
                  id="system-prompt-text-global"
                  className="prompt-content-input"
                  value={spGlobalText}
                  onChange={(e) => { setSpGlobalText(e.target.value); }}
                  rows={8}
                  placeholder=""
                />
                <div className="actions" style={rowBetween}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {spGlobalCharCount.toLocaleString()} chars · ~{spGlobalTokenCount.toLocaleString()} tokens
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={async () => { await copyToClipboard(spGlobalText); }} title="Copy global system prompt">
                      <Copy size={14} /> {STRINGS.copy}
                    </button>
                    <button className="cancel-button" onClick={() => { setSpGlobalReplace(false); setSpGlobalText(''); }} title="Reset global to default">
                      {STRINGS.reset}
                    </button>
                  </div>
                </div>
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <div className="field-label-row">
                  <div className="field-label">Workspace System Prompt</div>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>
                      <input type="checkbox" checked={spWorkspaceReplace} onChange={(e) => setSpWorkspaceReplace(e.target.checked)} disabled={!workspaceId} />
                      <span style={{ marginLeft: 6 }}>Use only this prompt</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="system-prompt-text-workspace">Workspace prompt</label>
                <div className="help" style={{ ...secondaryTextStyle, marginTop: 4 }}>
                  Applies only to the active workspace. Leave empty to skip. Combined with Global unless &quot;Use only this prompt&quot; is set.
                </div>
                <textarea
                  id="system-prompt-text-workspace"
                  className="prompt-content-input"
                  value={spWorkspaceText}
                  onChange={(e) => { setSpWorkspaceText(e.target.value); }}
                  rows={8}
                  placeholder={workspaceId ? '' : 'Open a workspace to edit its prompt'}
                  disabled={!workspaceId}
                />
                <div className="actions" style={rowBetween}>
                  <div style={secondaryTextStyle}>
                    {spWorkspaceCharCount.toLocaleString()} chars · ~{spWorkspaceTokenCount.toLocaleString()} tokens
                  </div>
                  <div className="actions">
                    <button className="secondary" disabled={!workspaceId} onClick={async () => { await copyToClipboard(spWorkspaceText); }} title="Copy workspace system prompt">
                      <Copy size={14} /> {STRINGS.copy}
                    </button>
                    <button className="cancel-button" disabled={!workspaceId} onClick={() => { setSpWorkspaceReplace(false); setSpWorkspaceText(''); }} title="Reset workspace to default">
                      {STRINGS.reset}
                    </button>
                  </div>
                </div>
              </div>

              {/* Notes: The automatic summary has been removed. Execution context may be appended if enabled. */}
            </section>

            {usageStats && (
              <section className="settings-section">
                <div className="settings-grid">
                  <div className="field">
                    <div className="field-label">Session Tokens</div>
                  <div style={secondaryTextStyle}>
                      Input: {usageStats.totalIn.toLocaleString()} · Output: {usageStats.totalOut.toLocaleString()} · Total: {usageStats.total.toLocaleString()}
                    </div>
                  </div>
                  <div className="field">
                    <div className="field-label">Average Latency</div>
                    <div style={secondaryTextStyle}>{usageStats.avgLatency == null ? '—' : (usageStats.avgLatency >= 1000 ? `${(usageStats.avgLatency/1000).toFixed(2)}s` : `${usageStats.avgLatency}ms`)}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">Session Cost</div>
                    <div style={secondaryTextStyle}>{usageStats.totalCost == null ? '—' : `$${usageStats.totalCost.toFixed(4)}`}</div>
                  </div>
                </div>
              </section>
            )}


            <section className="settings-section">
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!sessionId || exporting === 'saving'}
                  onClick={async () => {
                    if (!sessionId) return;
                    setExporting('saving'); setExportPath(null);
                    try {
                      const result: unknown = await window.electron?.ipcRenderer?.invoke?.('agent:export-session', sessionId);
                      const _isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
                      const ok = _isObj(result) && (result as Record<string, unknown>)['success'] === true;
                      const data = _isObj(result) ? (result as Record<string, unknown>)['data'] : undefined;
                      const file = ok && _isObj(data) && typeof (data as { file?: unknown }).file === 'string' ? (data as { file: string }).file : null;
                      const payload = ok ? data : null;
                      if (file) setExportPath(String(file));
                      else if (payload) setExportPath('(export in memory)');
                      setExporting('success'); setTimeout(() => setExporting('idle'), 1000);
                    } catch (error) {
                      setExporting('error'); setError((error as Error)?.message || 'Export failed');
                    }
                  }}
                >
                  Export Chat Session
                </button>
                {exportPath && (
                  <span className="export-path">{exportPath}</span>
                )}
              </div>
              {approvalCounts ? (
                <div className="export-note">
                  Approvals exported: {approvalCounts.total} (pending {approvalCounts.pending}).
                </div>
              ) : null}
            </section>

            {status === 'error' && (
              <AgentAlertBanner variant="error" message={error || 'Failed to update'} />
            )}
          </div>
          <div className="modal-footer">
            <div style={{ flex: 1 }} />
            <button className="apply-button" disabled={!canSave} onClick={async () => {
              setStatus('saving'); setError(null);
              try {
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.temperature', value: temperature });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.maxOutputTokens', value: maxOut });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.enableFileWrite', value: enableWrites });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.enableCodeExecution', value: enableExec });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.executionContext.enabled', value: execCtxGlobalEnabled });
                if (workspaceId) {
                  await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: `agent.executionContext.enabled.${workspaceId}`, value: execCtxWorkspaceEnabled });
                }
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.approvalMode', value: approvalMode });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'ui.reasoning.defaultCollapsed', value: reasoningDefaultCollapsed });
                // System prompts: save global and workspace separately
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.systemPrompt.replace', value: spGlobalReplace });
                await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: 'agent.systemPrompt.text', value: spGlobalText });
                if (workspaceId) {
                  await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: `agent.systemPrompt.replace.${workspaceId}`, value: spWorkspaceReplace });
                  await window.electron?.ipcRenderer?.invoke?.(IPC.SET, { key: `agent.systemPrompt.text.${workspaceId}`, value: spWorkspaceText });
                }
                setStatus('success'); setTimeout(() => setStatus('idle'), 1000);
              } catch (error) { setStatus('error'); setError((error as Error)?.message || 'Failed to save'); }
            }}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
