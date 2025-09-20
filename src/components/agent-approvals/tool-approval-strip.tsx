import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import "./tool-approval-strip.css";

type ToolName = "file" | "edit" | "search" | "context" | "terminal";
type TerminalMode = "off" | "safe" | "all";

type PrefsObject = Readonly<{
  skipAll: boolean;
  autoCap: number;
  notifications: boolean;
  terminalMode: TerminalMode;
  auto: Readonly<Record<ToolName, boolean>>;
}>;

type Props = Readonly<{
  sessionId?: string | null;
  onChanged?: (prefs: PrefsObject) => void;
}>;

type PrefsInvoker = (channel: string, payload?: unknown) => Promise<unknown>;

function getApiInfo() {
  const info = (window as unknown as { __PF_API_INFO?: Record<string, unknown> }).__PF_API_INFO ?? {};
  const apiBase = typeof info.apiBase === "string" && info.apiBase ? (info.apiBase as string) : "http://localhost:5839";
  const authToken = typeof info.authToken === "string" ? (info.authToken as string) : "";
  return { apiBase, authToken } as const;
}

function getPrefsInvoker(): PrefsInvoker | null {
  const invoker = (window as unknown as { electron?: { ipcRenderer?: { invoke?: PrefsInvoker } } }).electron?.ipcRenderer?.invoke;
  return typeof invoker === "function" ? invoker : null;
}

function toBool(v: unknown, fallback = false): boolean {
  const raw = (v as { data?: unknown })?.data ?? v;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  return fallback;
}

function toIntInRange(v: unknown, min: number, max: number, fallback = 0): number {
  const raw = (v as { data?: unknown })?.data ?? v;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toTerminalMode(v: unknown): TerminalMode {
  const raw = (v as { data?: unknown })?.data ?? v;
  const s = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (s === "safe" || s === "all") return s;
  return "off";
}

const DEFAULT_PREFS: PrefsObject = Object.freeze({
  skipAll: false,
  autoCap: 5,
  notifications: false,
  terminalMode: "off",
  auto: Object.freeze({
    file: false,
    edit: false,
    search: false,
    context: false,
    terminal: false,
  }),
});

const ALL_TOOLS: readonly ToolName[] = ["file", "edit", "search", "context", "terminal"] as const;

export default function ToolApprovalStrip({ sessionId = null, onChanged }: Props) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [enabledTools, setEnabledTools] = useState<readonly ToolName[]>(ALL_TOOLS);
  const [prefs, setPrefs] = useState<PrefsObject>(DEFAULT_PREFS);
  const { apiBase, authToken } = getApiInfo();
  const invokeRef = useRef<PrefsInvoker | null>(null);
  const debounceTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    invokeRef.current = getPrefsInvoker();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEnabledTools() {
      try {
        const res = await fetch(`${apiBase}/api/v1/tools`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });
        const json = await res.json().catch(() => ({}));
        const enabledRec = (json && json.data && typeof json.data.enabled === "object") ? (json.data.enabled as Record<string, boolean>) : {};
        const names = ALL_TOOLS.filter((t) => enabledRec[t] !== false);
        if (!cancelled) setEnabledTools(names);
      } catch {
        if (!cancelled) setEnabledTools(ALL_TOOLS);
      }
    }

    async function loadPrefs() {
      const inv = invokeRef.current;
      if (!inv) return;
      try {
        const [
          skipAllR,
          capR,
          notifyR,
          termModeR,
          autoFileR,
          autoEditR,
          autoSearchR,
          autoContextR,
          autoTerminalR,
          expandedR,
        ] = await Promise.all([
          inv("/prefs/get", { key: "agent.approvals.skipAll" }),
          inv("/prefs/get", { key: "agent.approvals.autoCap" }),
          inv("/prefs/get", { key: "agent.approvals.notifications" }),
          inv("/prefs/get", { key: "agent.approvals.terminal.autoMode" }),
          inv("/prefs/get", { key: "agent.approvals.auto.file" }),
          inv("/prefs/get", { key: "agent.approvals.auto.edit" }),
          inv("/prefs/get", { key: "agent.approvals.auto.search" }),
          inv("/prefs/get", { key: "agent.approvals.auto.context" }),
          inv("/prefs/get", { key: "agent.approvals.auto.terminal" }),
          inv("/prefs/get", { key: "ui.toolStrip.expanded" }),
        ]);
        if (cancelled) return;
        const next: PrefsObject = Object.freeze({
          skipAll: toBool(skipAllR, false),
          autoCap: toIntInRange(capR, 0, 50, 5),
          notifications: toBool(notifyR, false),
          terminalMode: toTerminalMode(termModeR),
          auto: Object.freeze({
            file: toBool(autoFileR, false),
            edit: toBool(autoEditR, false),
            search: toBool(autoSearchR, false),
            context: toBool(autoContextR, false),
            terminal: toBool(autoTerminalR, false),
          }),
        });
        setPrefs(next);
        setExpanded(toBool(expandedR, false));
        try { onChanged?.(next); } catch { /* noop */ }
      } catch {
        // keep defaults
      }
    }

    void loadEnabledTools();
    void loadPrefs();

    return () => { cancelled = true; };
  }, [apiBase, authToken, onChanged]);

  const persistPref = useCallback((key: string, value: unknown) => {
    const inv = invokeRef.current;
    if (!inv) return;
    const timers = debounceTimers.current;
    const prev = timers.get(key);
    if (prev !== undefined) {
      window.clearTimeout(prev);
    }
    const id = window.setTimeout(async () => {
      try {
        await inv("/prefs/set", { key, value });
      } catch {
        // ignore
      }
    }, 250);
    timers.set(key, id);
  }, []);

  useEffect(() => {
    return () => {
      const timers = debounceTimers.current;
      for (const id of timers.values()) {
        window.clearTimeout(id);
      }
      timers.clear();
    };
  }, []);

  function readValueForKey(p: PrefsObject, key: string, expandedValue: boolean): unknown {
    switch (key) {
      case "agent.approvals.skipAll": { return p.skipAll;
      }
      case "agent.approvals.autoCap": { return p.autoCap;
      }
      case "agent.approvals.notifications": { return p.notifications;
      }
      case "agent.approvals.terminal.autoMode": { return p.terminalMode;
      }
      case "agent.approvals.auto.file": { return p.auto.file;
      }
      case "agent.approvals.auto.edit": { return p.auto.edit;
      }
      case "agent.approvals.auto.search": { return p.auto.search;
      }
      case "agent.approvals.auto.context": { return p.auto.context;
      }
      case "agent.approvals.auto.terminal": { return p.auto.terminal;
      }
      case "ui.toolStrip.expanded": { return expandedValue;
      }
      default: { return null;
      }
    }
  }

  const setAndPersist = useCallback((patch: Partial<PrefsObject>, keys: readonly string[]) => {
    setPrefs((prev) => {
      const merged: PrefsObject = Object.freeze({
        skipAll: patch.skipAll ?? prev.skipAll,
        autoCap: patch.autoCap ?? prev.autoCap,
        notifications: patch.notifications ?? prev.notifications,
        terminalMode: (patch.terminalMode ?? prev.terminalMode) as TerminalMode,
        auto: Object.freeze({
          ...prev.auto,
          ...patch.auto,
        } as Record<ToolName, boolean>),
      });
      for (const k of keys) persistPref(k, readValueForKey(merged, k, expanded));
      try { onChanged?.(merged); } catch { /* noop */ }
      return merged;
    });
  }, [persistPref, onChanged, expanded]);

  const onToggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    persistPref("ui.toolStrip.expanded", next);
  }, [expanded, persistPref]);

  const onToggleSkipAll = useCallback(() => {
    setAndPersist({ skipAll: !prefs.skipAll }, ["agent.approvals.skipAll"]);
  }, [prefs.skipAll, setAndPersist]);

  const onToggleNotifications = useCallback(() => {
    setAndPersist({ notifications: !prefs.notifications }, ["agent.approvals.notifications"]);
  }, [prefs.notifications, setAndPersist]);

  const onChangeCap = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.currentTarget.value);
    const value = Number.isFinite(n) ? Math.max(0, Math.min(50, Math.trunc(n))) : 0;
    setAndPersist({ autoCap: value }, ["agent.approvals.autoCap"]);
  }, [setAndPersist]);

  const onToggleTool = useCallback((tool: ToolName) => {
    const nextVal = !prefs.auto[tool];
    const autoPatch = { ...prefs.auto, [tool]: nextVal } as Record<ToolName, boolean>;
    let terminalMode: TerminalMode = prefs.terminalMode;
    if (tool === "terminal") {
      if (nextVal && terminalMode === "off") {
        terminalMode = "safe";
      }
      if (!nextVal) {
        terminalMode = "off";
      }
    }
    setAndPersist(
      { auto: autoPatch, terminalMode },
      [
        `agent.approvals.auto.${tool}`,
        ...(tool === "terminal" ? ["agent.approvals.terminal.autoMode"] as const : []),
      ]
    );
  }, [prefs.auto, prefs.terminalMode, setAndPersist]);

  const onToggleAllTools = useCallback(() => {
    const enabledSet = new Set(enabledTools);
    const anyDisabled = enabledTools.some((t) => prefs.auto[t] === false);
    const nextAuto: Record<ToolName, boolean> = { ...prefs.auto } as Record<ToolName, boolean>;
    for (const t of enabledTools) { nextAuto[t] = anyDisabled; }
    let terminalMode: TerminalMode = prefs.terminalMode;
    if (enabledSet.has("terminal")) {
      terminalMode = anyDisabled ? (prefs.terminalMode === "off" ? "safe" : prefs.terminalMode) : "off";
    }
    const keys: string[] = [];
    for (const t of enabledTools) keys.push(`agent.approvals.auto.${t}`);
    if (enabledSet.has("terminal")) keys.push("agent.approvals.terminal.autoMode");
    setAndPersist({ auto: nextAuto, terminalMode }, keys);
  }, [enabledTools, prefs.auto, prefs.terminalMode, setAndPersist]);

  const setTerminalMode = useCallback((mode: TerminalMode) => {
    const autoPatch = { ...prefs.auto, terminal: mode !== "off" } as Record<ToolName, boolean>;
    setAndPersist(
      { auto: autoPatch, terminalMode: mode },
      ["agent.approvals.terminal.autoMode", "agent.approvals.auto.terminal"]
    );
  }, [prefs.auto, setAndPersist]);

  const compactTools = useMemo(() => enabledTools, [enabledTools]);

  return (
    <section className="tool-approval-strip" aria-label="Tool auto-approval settings" role="group">
      <div className="tool-approval-strip__compact">
        <span className="tool-approval-strip__label">Auto-approve:</span>
        <div className="tool-approval-strip__tools" role="group" aria-label="Per-tool auto-approve">
          {compactTools.map((tool) => (
            <label key={tool} className="tool-approval-strip__tool">
              <input
                type="checkbox"
                checked={prefs.auto[tool]}
                onChange={() => onToggleTool(tool)}
              />
              <span>{tool}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className={`tool-approval-strip__toggle ${expanded ? "is-expanded" : ""}`}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse tool approvals" : "Expand tool approvals"}
          onClick={onToggleExpanded}
          title={expanded ? "Collapse" : "Expand"}
        >
          <ArrowUp size={14} />
        </button>
      </div>

      {expanded ? (
        <div className="tool-approval-strip__expanded">
          <div className="tool-approval-strip__col tool-approval-strip__col--left">
            <label className="tool-approval-strip__row">
              <input type="checkbox" checked={prefs.skipAll} onChange={onToggleSkipAll} />
              <span>Enable auto-approve</span>
            </label>

            <div className="tool-approval-strip__row">
              <button type="button" className="secondary" onClick={onToggleAllTools}>Toggle all tools</button>
            </div>

            <label className="tool-approval-strip__row">
              <input
                type="checkbox"
                checked={prefs.auto.file}
                onChange={() => onToggleTool("file")}
              />
              <span>Read project files</span>
            </label>

            <label className="tool-approval-strip__row">
              <input
                type="checkbox"
                checked={prefs.auto.edit}
                onChange={() => onToggleTool("edit")}
              />
              <span>Edit project files</span>
            </label>

            <div className="tool-approval-strip__group">
              <div className="tool-approval-strip__group-label">Terminal approvals</div>
              <div className="tool-approval-strip__radios" role="group" aria-label="Terminal auto-approval mode">
                <label>
                  <input
                    type="radio"
                    name="terminal-mode"
                    checked={prefs.terminalMode === "off"}
                    onChange={() => setTerminalMode("off")}
                  />
                  <span>Off</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="terminal-mode"
                    checked={prefs.terminalMode === "safe"}
                    onChange={() => setTerminalMode("safe")}
                  />
                  <span>Execute safe commands</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="terminal-mode"
                    checked={prefs.terminalMode === "all"}
                    onChange={() => setTerminalMode("all")}
                  />
                  <span>Execute all commands</span>
                </label>
              </div>
            </div>
          </div>

          <div className="tool-approval-strip__col tool-approval-strip__col--right">
            <label className="tool-approval-strip__row">
              <input type="checkbox" checked={prefs.notifications} onChange={onToggleNotifications} />
              <span>Enable notifications</span>
            </label>

            <label className="tool-approval-strip__row">
              <span>Max Requests</span>
              <input
                className="tool-approval-strip__number"
                type="number"
                min={0}
                max={50}
                value={prefs.autoCap}
                onChange={onChangeCap}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}