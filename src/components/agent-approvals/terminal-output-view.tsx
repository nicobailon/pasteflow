import { useEffect, useMemo, useRef, useState } from "react";

type TerminalOutputViewProps = Readonly<{
  sessionId: string | null;
  previewId: string;
  command?: string | null;
  cwd?: string | null;
  initialText?: string | null;
  isActive?: boolean;
  onOpenPanel?: () => void;
}>;

type OutputChunk = Readonly<{ chunk?: string; nextCursor?: number }>;

type InvokeResult = Readonly<{ success: boolean; data?: OutputChunk | null }>;

const MAX_BUFFER = 200_000;
const POLL_INTERVAL_MS = 600;

function appendLimited(prev: string, nextChunk: string): string {
  const next = prev + nextChunk;
  if (next.length <= MAX_BUFFER) return next;
  return next.slice(-MAX_BUFFER);
}

export default function TerminalOutputView({ sessionId, previewId, command, cwd, initialText = "", isActive = true, onOpenPanel }: TerminalOutputViewProps) {
  const [text, setText] = useState<string>(initialText ?? "");
  const cursorRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset when session changes
  useEffect(() => {
    setText(initialText || "");
    cursorRef.current = 0;
  }, [initialText, sessionId]);

  // Poll for incremental output
  useEffect(() => {
    if (!sessionId || !isActive) return () => {};
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = (await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (channel: string, payload?: unknown) => Promise<unknown> } } }).electron?.ipcRenderer?.invoke?.(
          "terminal:output:get",
          { id: sessionId, fromCursor: cursorRef.current, maxBytes: 64 * 1024 }
        )) as InvokeResult | undefined;
        if (result && result.success && result.data) {
          const chunk = typeof result.data.chunk === "string" ? result.data.chunk : "";
          if (chunk) {
            setText((prev) => appendLimited(prev, chunk));
          }
          if (typeof result.data.nextCursor === "number" && Number.isFinite(result.data.nextCursor)) {
            cursorRef.current = result.data.nextCursor;
          }
        }
      } catch {
        // Soft-fail: polling errors are expected if the session ends
      }
      if (!cancelled) {
        timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timerRef.current = window.setTimeout(poll, 0);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId, isActive]);

  // Auto-scroll to bottom when new content arrives and the user is already near the bottom
  const shouldAutoScroll = useRef<boolean>(true);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    shouldAutoScroll.current = nearBottom;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (shouldAutoScroll.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [text]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    shouldAutoScroll.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  };

  const openPanelHandler = useMemo(() => {
    if (typeof onOpenPanel === "function") return onOpenPanel;
    return () => {
      try {
        window.dispatchEvent(new CustomEvent("pasteflow:toggle-terminal", { detail: { source: "approval", previewId } }));
      } catch {
        // ignore failures
      }
    };
  }, [onOpenPanel, previewId]);

  if (!sessionId) {
    return (
      <div className="terminal-preview terminal-preview--inactive">
        <div className="terminal-preview__meta">No live terminal session available.</div>
        {text ? <pre className="terminal-preview__log">{text}</pre> : null}
      </div>
    );
  }

  return (
    <div className="terminal-preview">
      <div className="terminal-preview__header">
        <span className="terminal-preview__session">Session: {sessionId.slice(0, 8)}…</span>
        {command ? <span className="terminal-preview__command">{command}</span> : null}
        {cwd ? <span className="terminal-preview__cwd">in {cwd}</span> : null}
        <button type="button" className="terminal-preview__open" onClick={openPanelHandler}>
          Open in terminal panel
        </button>
      </div>
      <div
        ref={containerRef}
        className="terminal-preview__log"
        onScroll={handleScroll}
        role="log"
        aria-live={isActive ? "polite" : "off"}
      >
        {text || "(Waiting for output…)"}
      </div>
    </div>
  );
}
