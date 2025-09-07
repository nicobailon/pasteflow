import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
export default function TerminalPanel({ isOpen, onClose, defaultCwd = null }: TerminalPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [sessions, setSessions] = useState<TerminalMeta[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [fallbackText, setFallbackText] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);

  const xtermRef = useRef<any | null>(null);
  const fitAddonRef = useRef<any | null>(null);
  const termElRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);


  const writeToTerm = useCallback((data: string) => {
    if (xtermRef.current) {
      try { xtermRef.current.write(data); } catch { /* ignore */ }
    } else {
      setFallbackText((prev) => (prev + data).slice(-200000));
    }
  }, []);

  const fetchEnabled = useCallback(async (): Promise<boolean> => {
    try {
      const res: Result<TerminalMeta[] | null> = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:list');
      if (res && typeof res === 'object' && 'success' in res) {
        if ((res as any).success) {
          setEnabled(true);
          setSessions(((res as any).data || []) as TerminalMeta[]);
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
    } catch (e: any) {
      setErr((e as Error)?.message || 'Failed to create terminal');
    } finally {
      setCreating(false);
    }
  }, [defaultCwd]);

  const pollOutput = useCallback(async (sid: string) => {
    try {
      const res: Result<OutputChunk, string> = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:output:get', { id: sid, fromCursor: cursor, maxBytes: 64 * 1024 });
      if (res && res.success) {
        const { chunk, nextCursor } = res.data;
        if (chunk && chunk.length) writeToTerm(chunk);
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
      try {
        // Avoid static import specifiers to keep xterm optional in dev
        const XTERM = ['x', 'term'].join('');
        const FIT = ['xterm-addon', 'fit'].join('-');
        const LINKS = ['xterm-addon', 'web-links'].join('-');

        let TerminalCtor: any = null;
        let FitAddonCtor: any = null;
        let WebLinksAddonCtor: any = null;
        try { TerminalCtor = (await import(/* @vite-ignore */ XTERM)).Terminal; } catch {}
        try { FitAddonCtor = (await import(/* @vite-ignore */ FIT)).FitAddon; } catch {}
        try { WebLinksAddonCtor = (await import(/* @vite-ignore */ LINKS)).WebLinksAddon; } catch {}

        if (TerminalCtor) {
          const term = new TerminalCtor({ convertEol: true, fontSize: 12, cursorBlink: true });
          const fit = FitAddonCtor ? new FitAddonCtor() : null;
          const links = WebLinksAddonCtor ? new WebLinksAddonCtor() : null;
          if (fit) term.loadAddon(fit);
          if (links) term.loadAddon(links);
          term.open(termElRef.current);
          if (fit) { try { fit.fit(); } catch {} }
          xtermRef.current = term;
          fitAddonRef.current = fit;
          setReady(true);
        } else {
          // Fallback mode
          xtermRef.current = null;
          fitAddonRef.current = null;
          setReady(true);
        }
      } catch {
        xtermRef.current = null;
        fitAddonRef.current = null;
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, fetchEnabled]);

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
      unsub = () => { try { (window as any).electron?.ipcRenderer?.removeListener?.(ch, handler); } catch {} };
    } catch { /* ignore */ }
    // Poll fallback
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => { void pollOutput(session.id); }, 250);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); pollTimerRef.current = null; if (unsub) unsub(); };
  }, [isOpen, session, pollOutput, writeToTerm]);

  // Resize observer for xterm
  useEffect(() => {
    if (!isOpen || !termElRef.current || !fitAddonRef.current) return;
    const ro = new ResizeObserver(() => { try { fitAddonRef.current.fit(); } catch { /* ignore */ } });
    ro.observe(termElRef.current);
    return () => { try { ro.disconnect(); } catch {} };
  }, [isOpen]);

  if (!isOpen) return null;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border-color)", padding: "6px 8px", background: "var(--bg-secondary)" }}>
      <div style={{ fontWeight: 600 }}>Terminal</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {enabled === false ? "Execution disabled by config" : (session ? `PID ${session.pid}` : creating ? "Starting…" : "Idle")}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="secondary" onClick={onClose} aria-label="Close terminal">Close</button>
      </div>
    </div>
  );

  if (enabled === false) {
    return (
      <div className="agent-terminal" style={{ borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", height: 260 }}>
        {header}
        <div style={{ padding: 12, color: "var(--text-secondary)" }}>
          Code execution is disabled. Enable it in preferences to use the terminal.
        </div>
      </div>
    );
  }

  return (
    <div className="agent-terminal" style={{ borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", height: 260 }}>
      {header}
      <div style={{ flex: 1, display: "flex" }}>
        <div ref={termElRef} style={{ flex: 1, background: "#111" }} />
        {!xtermRef.current && (
          <pre style={{ flex: 1, margin: 0, padding: 8, background: "#111", color: "#eee", fontSize: 12, overflow: 'auto' }}>{fallbackText}</pre>
        )}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!input) return; void sendInput(input.endsWith("\n") ? input : input + "\n"); setInput(""); }}
        style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid var(--border-color)" }}
      >
        <input
          type="text"
          value={input}
          disabled={!session || creating}
          onChange={(e) => setInput(e.target.value)}
          placeholder={session ? "Type a command…" : creating ? "Starting…" : "Start a session"}
          style={{ flex: 1 }}
        />
        <button className="primary" type="submit" disabled={!session || creating}>Send</button>
      </form>
      {err && <div style={{ color: "#a00", fontSize: 12, padding: "4px 8px" }}>Error: {err}</div>}
    </div>
  );
}
