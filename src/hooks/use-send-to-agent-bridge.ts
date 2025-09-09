import { useEffect, type MutableRefObject } from "react";

export interface UseSendToAgentBridgeOptions {
  readonly sessionId: string | null;
  readonly ensureSessionOrRetry: () => Promise<string | null>;
  readonly sendMessage: (payload: { text: string }) => unknown;
  readonly lastInitialRef: MutableRefObject<unknown>;
  readonly buildInitialSummaryMessage: (envelope: unknown) => string;
}

export default function useSendToAgentBridge(opts: UseSendToAgentBridgeOptions): void {
  const { sessionId, ensureSessionOrRetry, sendMessage, lastInitialRef, buildInitialSummaryMessage } = opts;

  useEffect(() => {
    const handler = async (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      const detail = (ce && typeof ce === 'object' && (ce as any).detail) ? (ce as any).detail : null;
      if (!detail) return;
      if (!sessionId) {
        const id = await ensureSessionOrRetry();
        if (!id) return;
        await new Promise((r) => setTimeout(r, 0));
      }
      if (typeof (detail as any).text === 'string' && (detail as any).text.length > 0) {
        sendMessage({ text: (detail as any).text as string });
        return;
      }
      if ((detail as any).context && (detail as any).context.version === 1) {
        lastInitialRef.current = (detail as any).context.initial || null;
        const summary = buildInitialSummaryMessage((detail as any).context);
        sendMessage({ text: summary });
      }
    };
    window.addEventListener("pasteflow:send-to-agent", handler as EventListener);
    return () => window.removeEventListener("pasteflow:send-to-agent", handler as EventListener);
  }, [sendMessage, ensureSessionOrRetry, sessionId, lastInitialRef, buildInitialSummaryMessage]);
}

