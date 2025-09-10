import { useEffect, useRef, type MutableRefObject } from "react";

export interface UseSendToAgentBridgeOptions {
  readonly sessionId: string | null;
  readonly ensureSessionOrRetry: () => Promise<string | null>;
  readonly sendMessage: (payload: { text: string }) => unknown;
  readonly lastInitialRef: MutableRefObject<unknown>;
  readonly buildInitialSummaryMessage: (envelope: unknown) => string;
  /** Remember last workspace from envelope for server-side tool gating */
  readonly setLastWorkspace?: (ws: string | null) => void;
  /** Queue support when a session is starting/switching and not yet bound */
  readonly awaitingBind?: boolean;
  readonly isSwitchingThread?: boolean;
  readonly setQueuedFirstSend?: (text: string | null) => void;
  /** Optional: surface a transient notice to the UI when we queue a send */
  readonly onQueuedNotice?: (message: string, durationMs?: number) => void;
}

export default function useSendToAgentBridge(opts: UseSendToAgentBridgeOptions): void {
  const { sessionId, ensureSessionOrRetry, sendMessage, lastInitialRef, buildInitialSummaryMessage, setLastWorkspace, awaitingBind, isSwitchingThread, setQueuedFirstSend, onQueuedNotice } = opts;

  // Keep the latest values without reattaching the window listener
  const awaitingBindRef = useRef<boolean | undefined>(awaitingBind);
  const isSwitchingThreadRef = useRef<boolean | undefined>(isSwitchingThread);
  const setQueuedFirstSendRef = useRef<((t: string | null) => void) | undefined>(setQueuedFirstSend);
  const setLastWorkspaceRef = useRef<((ws: string | null) => void) | undefined>(setLastWorkspace);
  const onQueuedNoticeRef = useRef<((m: string, d?: number) => void) | undefined>(onQueuedNotice);

  useEffect(() => { awaitingBindRef.current = awaitingBind; }, [awaitingBind]);
  useEffect(() => { isSwitchingThreadRef.current = isSwitchingThread; }, [isSwitchingThread]);
  useEffect(() => { setQueuedFirstSendRef.current = setQueuedFirstSend; }, [setQueuedFirstSend]);
  useEffect(() => { setLastWorkspaceRef.current = setLastWorkspace; }, [setLastWorkspace]);
  useEffect(() => { onQueuedNoticeRef.current = onQueuedNotice; }, [onQueuedNotice]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      const detail: unknown = (ce && typeof ce === 'object') ? ce.detail : null;
      if (!detail) return;
      if (!sessionId) {
        const id = await ensureSessionOrRetry();
        if (!id) return;
        await new Promise((r) => setTimeout(r, 0));
      }
      const d = detail as { text?: unknown; context?: unknown; fullText?: unknown; displayText?: unknown };
      if (typeof d.text === 'string' && d.text.length > 0) {
        // Plain text path (no structured context)
        sendMessage({ text: d.text });
        return;
      }
      const ctxLike = (d && d.context && typeof d.context === 'object') ? (d.context as { version?: unknown; initial?: unknown; workspace?: unknown }) : null;
      if (ctxLike && ctxLike.version === 1) {
        lastInitialRef.current = ctxLike.initial || null;
        if (setLastWorkspaceRef.current) {
          const ws = typeof ctxLike.workspace === 'string' ? ctxLike.workspace : null;
          setLastWorkspaceRef.current(ws);
        }
        // If provided, set an override so the request payload uses full content
        const fullText = typeof d.fullText === 'string' ? d.fullText : null;

        // Choose display text for the visible UI message
        const displayText = typeof d.displayText === 'string' && d.displayText.trim().length > 0
          ? d.displayText
          : buildInitialSummaryMessage(d.context);

        // If the session is mid-bind/switch, queue the full text for sending once ready
        if ((awaitingBindRef.current || isSwitchingThreadRef.current) && setQueuedFirstSendRef.current) {
          const toQueue = fullText || displayText;
          setQueuedFirstSendRef.current(toQueue);
          if (onQueuedNoticeRef.current) onQueuedNoticeRef.current('Queued — sending after chat starts…', 1800);
          // Do not append a visible message yet; composer path handles showing it after bind
          return;
        }

        // Preferred path: send full text as the user message.
        // UI condenses code blocks for display, so visual output stays readable.
        if (typeof fullText === 'string' && fullText.length > 0) {
          if (process.env.NODE_ENV === 'development') {
            try { console.log('[UI][send-to-agent] sending FULL text', { length: fullText.length }); } catch { /* noop */ }
          }
          sendMessage({ text: fullText });
          return;
        }
        // Fallback: no fullText available; send the condensed preview text
        if (process.env.NODE_ENV === 'development') {
          try { console.log('[UI][send-to-agent] sending display text (no fullText)', { length: displayText.length }); } catch { /* noop */ }
        }
        sendMessage({ text: displayText });
      }
    };
    window.addEventListener("pasteflow:send-to-agent", handler as EventListener);
    return () => window.removeEventListener("pasteflow:send-to-agent", handler as EventListener);
  }, [sendMessage, ensureSessionOrRetry, sessionId, lastInitialRef, buildInitialSummaryMessage]);
}
