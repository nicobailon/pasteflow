import { useCallback, useEffect, useRef, useState } from "react";
import "./terminal-panel.css";

// Minimal xterm types to avoid using 'any'
type XtermTerminal = {
  element?: HTMLElement;
  open: (el: HTMLElement) => void;
  write: (data: string) => void;
  loadAddon?: (addon: unknown) => void;
  onData?: (handler: (data: string) => void) => void;
  focus?: () => void;
};

type FitAddonType = { fit: () => void };
// Inline module types are used in dynamic import casts inside loadXterm.

// Small utility: check if a scrollable element is near bottom
function isNearBottom(el: HTMLElement | null, threshold = 24): boolean {
  if (!el) return true;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

type LoadXtermResult = { term: XtermTerminal; fit?: FitAddonType };

// Load xterm and addons dynamically; returns created terminal and optional fit addon
async function loadXterm(termMount: HTMLElement, onData: (d: string) => void): Promise<LoadXtermResult | null> {
  const XTERM = ["x", "term"].join("");
  const FIT = ["xterm-addon", "fit"].join("-");
  const LINKS = ["xterm-addon", "web-links"].join("-");
  try {
    const mod = (await import(/* @vite-ignore */ XTERM)) as unknown as { Terminal?: new (opts?: Record<string, unknown>) => XtermTerminal };
    const TerminalCtor = mod.Terminal;
    if (!TerminalCtor) return null;
    const term: XtermTerminal = new TerminalCtor({ convertEol: true, fontSize: 12, cursorBlink: true });
    let fitAddon: FitAddonType | undefined;
    try {
      const fitMod = (await import(/* @vite-ignore */ FIT)) as unknown as { FitAddon?: new () => FitAddonType };
      if (fitMod.FitAddon) {
        fitAddon = new fitMod.FitAddon();
        term.loadAddon?.(fitAddon);
        try { fitAddon.fit(); } catch { /* noop */ }
      }
    } catch { /* optional */ }
    try {
      const linksMod = (await import(/* @vite-ignore */ LINKS)) as unknown as { WebLinksAddon?: new () => unknown };
      if (linksMod.WebLinksAddon) term.loadAddon?.(new linksMod.WebLinksAddon());
    } catch { /* optional */ }
    term.open(termMount);
    try { term.onData?.(onData); } catch { /* noop */ }
    try { term.focus?.(); } catch { /* noop */ }
    return { term, fit: fitAddon };
  } catch {
    return null;
  }
}

type Result<T, E extends string = string> = { success: true; data: T } | { success: false; error: E };

type TerminalSession = { id: string; pid: number };
type TerminalMeta = { id: string; pid: number; cwd: string; cols: number; rows: number; createdAt: number; name: string };
type OutputChunk = { chunk: string; nextCursor: number; truncated: boolean };

export type TerminalPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  defaultCwd?: string | null;
};

/**
 * TerminalPanel
 * - Lazy loads xterm when available; no hard dependency to keep tests/pass without install.
 * - Pull-based streaming using IPC 'terminal:output:get'.
 * - Gated by ENABLE_CODE_EXECUTION (panel shows a banner otherwise).
 */
export default function TerminalPanel({ isOpen, onClose: _onClose, defaultCwd = null }: TerminalPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  // const [sessions, setSessions] = useState<TerminalMeta[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [fallbackText, setFallbackText] = useState<string>("");
  const [currentLine, setCurrentLine] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [_histIdx, setHistIdx] = useState<number>(-1);
  const [err, setErr] = useState<string | null>(null);
  const [, setReady] = useState(false);
  const [creating, setCreating] = useState(false);

  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const termElRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);


  const getViewportEl = useCallback((): HTMLElement | null => {
    const term = xtermRef.current;
    try {
      if (term?.element) {
        const el = term.element.querySelector('.xterm-viewport') as HTMLElement | null;
        if (el) return el;
      }
    } catch { /* noop */ }
    return scrollRef.current;
  }, []);

  // (moved to module scope)

  const writeToTerm = useCallback((data: string) => {
    const vp = getViewportEl();
    const shouldAuto = isNearBottom(vp);
    if (xtermRef.current) {
      try { xtermRef.current.write(data); } catch { /* ignore */ }
      if (shouldAuto && vp) requestAnimationFrame(() => { try { vp.scrollTop = vp.scrollHeight; } catch { /* noop */ } });
    } else {
      setFallbackText((prev) => {
        const next = (prev + data).slice(-200_000);
        if (shouldAuto) requestAnimationFrame(() => { const el = getViewportEl(); if (el) el.scrollTop = el.scrollHeight; });
        return next;
      });
    }
  }, [getViewportEl]);

  const fetchEnabled = useCallback(async (): Promise<boolean> => {
    try {
      const res: Result<TerminalMeta[] | null> = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:list');
      if (res && typeof res === 'object' && 'success' in res) {
        if ((res as any).success) {
          setEnabled(true);
          // setSessions(((res as any).data || []) as TerminalMeta[]);
          return true;
        }
        if ((res as any).error === 'EXECUTION_DISABLED') { setEnabled(false); return false; }
      }
    } catch { /* noop */ }
    setEnabled(false);
    return false;
  }, []);

  const startSession = useCallback(async () => {
    setCreating(true);
    try {
      const res: Result<TerminalSession, string> = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:create', defaultCwd ? { cwd: defaultCwd } : {});
      if (res && res.success) {
        setSession(res.data);
        setCursor(0);
        setErr(null);
      } else {
        const code = (res as any)?.error || 'UNKNOWN';
        setErr(String(code));
      }
    } catch (error: any) {
      setErr((error as Error)?.message || 'Failed to create terminal');
    } finally {
      setCreating(false);
    }
  }, [defaultCwd]);

  const pollOutput = useCallback(async (sid: string) => {
    try {
      const res: Result<OutputChunk, string> = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:output:get', { id: sid, fromCursor: cursor, maxBytes: 64 * 1024 });
      if (res && res.success) {
        const { chunk, nextCursor } = res.data;
        if (chunk && chunk.length > 0) writeToTerm(chunk);
        setCursor(nextCursor);
      }
    } catch { /* ignore transient */ }
  }, [cursor, writeToTerm]);

  const sendInput = useCallback(async (text: string) => {
    const sid = session?.id;
    if (!sid || !text) return;
    try {
      await (window as any).electron?.ipcRenderer?.invoke?.('terminal:write', { id: sid, data: text });
    } catch { /* ignore */ }
  }, [session]);

  // Lazy load xterm when panel opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setReady(false);
      const ok = await fetchEnabled();
      if (!ok) { setReady(true); return; }
      if (cancelled) return;
      if (!termElRef.current) return;
      const created = await loadXterm(termElRef.current, async (d: string) => {
        const sid = session?.id;
        if (!sid) return;
        await (window as any).electron?.ipcRenderer?.invoke?.('terminal:write', { id: sid, data: d });
      });
      xtermRef.current = created ? created.term : null;
      fitAddonRef.current = created?.fit ?? null;
      setReady(true);
      if (!created) {
        // Fallback mode: focus the fallback input line
        requestAnimationFrame(() => {
          try {
            const el = scrollRef.current?.querySelector('.terminal-fallback') as HTMLElement | null;
            el?.focus();
          } catch { /* noop */ }
        });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, fetchEnabled, session]);

  // Start a new session when panel opens and enabled
  useEffect(() => {
    if (!isOpen) return;
    if (enabled === false) return;
    if (session) return;
    void startSession();
  }, [isOpen, enabled, session, startSession]);

  // Poll output
  useEffect(() => {
    if (!isOpen || !session) return;
    // Push-based (preferred)
    let unsub: (() => void) | null = null;
    try {
      const ch = `terminal:output:${session.id}`;
      const handler = (_: unknown, payload: { chunk?: string }) => {
        if (payload?.chunk) writeToTerm(payload.chunk);
      };
      (window as any).electron?.ipcRenderer?.on?.(ch, handler);
      unsub = () => { try { (window as any).electron?.ipcRenderer?.removeListener?.(ch, handler); } catch { /* noop */ } };
    } catch { /* ignore */ }
    // Poll fallback
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => { void pollOutput(session.id); }, 250);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); pollTimerRef.current = null; if (unsub) unsub(); };
  }, [isOpen, session, pollOutput, writeToTerm]);

  // Resize observer for xterm
  useEffect(() => {
    if (!isOpen || !termElRef.current || !fitAddonRef.current) return;
    const ro = new ResizeObserver(() => { try { fitAddonRef.current.fit(); } catch { /* noop */ } });
    ro.observe(termElRef.current);
    return () => { try { ro.disconnect(); } catch { /* noop */ } };
  }, [isOpen]);

  if (!isOpen) return null;

  const promptSymbol = '$ ';

  return (
    <div className="agent-terminal" style={{ display: "flex", flexDirection: "column", height: 280, width: '100%' }}>
      {enabled === false && (
        <div className="terminal-disabled-banner">Code execution is disabled. Enable it in Agent Settings to use the terminal.</div>
      )}
      <div
        ref={scrollRef}
        className="terminal-scroll"
        role="button"
        tabIndex={0}
        onClick={() => {
          try { const el = scrollRef.current?.querySelector('.terminal-fallback') as HTMLElement | null; el?.focus(); } catch { /* noop */ }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            try { const el = scrollRef.current?.querySelector('.terminal-fallback') as HTMLElement | null; el?.focus(); } catch { /* noop */ }
          }
        }}
      >
        <div ref={termElRef} />
        {!xtermRef.current && (
          <div
            className="terminal-fallback"
            role="textbox"
            tabIndex={0}
            onKeyDown={async (e) => {
              if (!session || creating) return;
              const vp = getViewportEl();
              const auto = isNearBottom(vp);
              const scrollBottom = () => {
                if (auto) requestAnimationFrame(() => { const el = getViewportEl(); if (el) el.scrollTop = el.scrollHeight; });
              };
              switch (e.key) {
                case 'Enter': {
                  e.preventDefault();
                  const line = currentLine;
                  setHistory((h) => [...h, line]);
                  setHistIdx(-1);
                  setCurrentLine('');
                  await sendInput(line + "\n");
                  setFallbackText((prev) => {
                    const next = prev + (prev.endsWith("\n") ? '' : "\n") + promptSymbol + line + "\n";
                    scrollBottom();
                    return next;
                  });
                  break;
                }
                case 'Backspace': {
                  e.preventDefault();
                  setCurrentLine((s) => s.slice(0, -1));
                  break;
                }
                case 'ArrowUp': {
                  e.preventDefault();
                  setHistIdx((idx) => {
                    const next = (idx < 0 ? history.length - 1 : Math.max(0, idx - 1));
                    setCurrentLine(history[next] ?? '');
                    return next;
                  });
                  break;
                }
                case 'ArrowDown': {
                  e.preventDefault();
                  setHistIdx((idx) => {
                    const next = idx < 0 ? -1 : Math.min(history.length - 1, idx + 1);
                    setCurrentLine(next >= 0 ? (history[next] ?? '') : '');
                    return next;
                  });
                  break;
                }
                default: {
                  const ch = e.key.length === 1 ? e.key : '';
                  if (ch) setCurrentLine((s) => { const next = s + ch; scrollBottom(); return next; });
                }
              }
            }}
          >
            <pre>{fallbackText}</pre>
            <div className="terminal-line">
              <span className="prompt-symbol">{promptSymbol}</span>
              <span className="command-text">{currentLine}</span>
              <span className="terminal-cursor" />
            </div>
          </div>
        )}
      </div>
      {err && <div className="terminal-error">Error: {err}</div>}
    </div>
  );
}
