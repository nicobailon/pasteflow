import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface UseAgentSessionResult {
  readonly sessionId: string | null;
  readonly setSessionId: Dispatch<SetStateAction<string | null>>;
  readonly hydratedMessages: readonly unknown[];
  readonly setHydratedMessages: Dispatch<SetStateAction<unknown[]>>;
  readonly isStartingChat: boolean;
  readonly isSwitchingThread: boolean;
  readonly setIsSwitchingThread: Dispatch<SetStateAction<boolean>>;
  readonly awaitingBind: boolean;
  readonly setAwaitingBind: Dispatch<SetStateAction<boolean>>;
  readonly queuedFirstSend: string | null;
  readonly setQueuedFirstSend: Dispatch<SetStateAction<string | null>>;
  ensureSession: () => Promise<string | null>;
  ensureSessionOrRetry: (maxAttempts?: number, delayMs?: number) => Promise<string | null>;
}

export default function useAgentSession(panelEnabled: boolean): UseAgentSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hydratedMessages, setHydratedMessages] = useState<unknown[]>([]);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSwitchingThread, setIsSwitchingThread] = useState(false);
  const [awaitingBind, setAwaitingBind] = useState(false);
  const [queuedFirstSend, setQueuedFirstSend] = useState<string | null>(null);

  // Prevent concurrent session creation
  const creatingSessionRef = useRef<Promise<string | null> | null>(null);

  async function startSessionBasic(): Promise<string | null> {
    try {
      const res: unknown = await (window as unknown as { electron?: { ipcRenderer?: { invoke?: (ch: string, data?: unknown) => Promise<unknown> } } }).electron?.ipcRenderer?.invoke?.('agent:start-session', {});
      const id = (res && (res as { success?: boolean; data?: { sessionId?: string } }).success)
        ? (res as { data?: { sessionId?: string } }).data?.sessionId
        : ((res as { data?: { sessionId?: string } } | undefined)?.data?.sessionId ?? (res as { sessionId?: string } | undefined)?.sessionId);
      if (typeof id !== 'string' || id.trim().length === 0) return null;
      setSessionId(id);
      setHydratedMessages([]);
      return id;
    } catch {
      return null;
    }
  }

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (creatingSessionRef.current) return creatingSessionRef.current;
    const p = startSessionBasic();
    creatingSessionRef.current = p.then((id) => { creatingSessionRef.current = null; return id; });
    return creatingSessionRef.current;
  }, [sessionId]);

  const ensureSessionOrRetry = useCallback(async (maxAttempts = 8, delayMs = 250): Promise<string | null> => {
    setIsStartingChat(true);
    try {
      for (let i = 0; i < maxAttempts; i++) {
        const id = await ensureSession();
        if (id) return id;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    } finally {
      setIsStartingChat(false);
    }
  }, [ensureSession]);

  // Auto-initialize a new chat session when the panel becomes enabled and no session exists
  const hasAutoInitializedRef = useRef(false);
  const autoInitAttemptsRef = useRef(0);
  useEffect(() => {
    if (!panelEnabled) {
      hasAutoInitializedRef.current = false;
      autoInitAttemptsRef.current = 0;
      return;
    }
    if (sessionId) return; // already active
    if (hasAutoInitializedRef.current) return; // guard
    (async () => {
      const id = await ensureSession();
      if (id) {
        hasAutoInitializedRef.current = true;
        autoInitAttemptsRef.current = 0;
      } else if (autoInitAttemptsRef.current < 5) {
        autoInitAttemptsRef.current += 1;
        setTimeout(async () => {
          if (!hasAutoInitializedRef.current && panelEnabled && !sessionId) {
            const id2 = await ensureSession();
            if (id2) {
              hasAutoInitializedRef.current = true;
              autoInitAttemptsRef.current = 0;
            }
          }
        }, 500);
      }
    })();
  }, [panelEnabled, sessionId, ensureSession]);

  // Re-enable input only after React commit with the new session id
  useEffect(() => {
    if (awaitingBind && sessionId) {
      const t = setTimeout(() => {
        setIsSwitchingThread(false);
        setAwaitingBind(false);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [awaitingBind, sessionId]);

  return {
    sessionId,
    setSessionId,
    hydratedMessages,
    setHydratedMessages,
    isStartingChat,
    isSwitchingThread,
    setIsSwitchingThread,
    awaitingBind,
    setAwaitingBind,
    queuedFirstSend,
    setQueuedFirstSend,
    ensureSession,
    ensureSessionOrRetry,
  };
}

