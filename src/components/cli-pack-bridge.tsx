import { useEffect, useRef } from "react";

/**
 * CliPackBridge
 * - Listens for main -> renderer IPC: 'cli-pack-start' and 'cli-pack-cancel'
 * - Dispatches DOM events so the existing ContentArea/usePreviewPack pipeline handles work
 * - Listens for minimal pack lifecycle DOM events to forward back to main via IPC
 *   - Sends RUNNING on start
 *   - Sends FAILED on error
 *   - Sends CANCELLED on cancel
 *   - Sends content on ready
 *
 * Phase 1: Minimal implementation without progress throttling or option overrides.
 */
export default function CliPackBridge() {
  const currentJobIdRef = useRef<string | null>(null);
  const sentStartRef = useRef<boolean>(false);
  const sentTerminalRef = useRef<boolean>(false);
  const lastProgressSentAtRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<number | null>(null);
  const pendingStateRef = useRef<any>(null);

  useEffect(() => {
    const ipc = (window as any)?.electron?.ipcRenderer;
    if (!ipc || typeof ipc.on !== "function" || typeof ipc.send !== "function") {
      // Not in Electron or preload not ready; nothing to do
      return;
    }

    const resetFlags = () => {
      sentStartRef.current = false;
      sentTerminalRef.current = false;
    };

    const handleStart = ({ id, options }: { id: string; options?: unknown }) => {
      try {
        if (!id || typeof id !== "string") return;
        // Cancel any in-flight job (last-write-wins)
        if (currentJobIdRef.current && currentJobIdRef.current !== id) {
          try { window.dispatchEvent(new Event("pf-cli-pack-cancel")); } catch {}
        }
        currentJobIdRef.current = id;
        resetFlags();
        // Reset progress throttle
        if (throttleTimeoutRef.current) {
          clearTimeout(throttleTimeoutRef.current);
          throttleTimeoutRef.current = null;
        }
        lastProgressSentAtRef.current = 0;
        pendingStateRef.current = null;
        // Bridge to UI pipeline
        window.dispatchEvent(new CustomEvent("pf-cli-pack-request", { detail: { id, options } }));
        // Minimal: immediately report RUNNING once per job
        if (!sentStartRef.current) {
          ipc.send("cli-pack-status", { id, state: "RUNNING", progress: 0 });
          sentStartRef.current = true;
        }
        // Light log for debugging
        // eslint-disable-next-line no-console
        console.log("[CLI_PACK] start", { id });
      } catch {
        // ignore
      }
    };

    const handleCancel = ({ id }: { id?: string }) => {
      try {
        const activeId = currentJobIdRef.current;
        // Forward cancel to UI regardless of id match (single worker per window)
        window.dispatchEvent(new Event("pf-cli-pack-cancel"));
        // Report CANCELLED for matching job id if any
        const targetId = id && typeof id === "string" ? id : activeId;
        if (targetId && !sentTerminalRef.current) {
          ipc.send("cli-pack-status", { id: targetId, state: "CANCELLED" });
          sentTerminalRef.current = true;
        }
        // eslint-disable-next-line no-console
        console.log("[CLI_PACK] cancel", { id: targetId });
      } catch {
        // ignore
      }
    };

    // UI -> IPC relays via pf-pack-state (throttled RUNNING)
    const THROTTLE_MS = 200;
    const flushProgress = () => {
      const id = currentJobIdRef.current;
      if (!id || !pendingStateRef.current || sentTerminalRef.current) return;
      const { processed, total, percent } = pendingStateRef.current;
      ipc.send("cli-pack-status", { id, state: "RUNNING", progress: Number.isFinite(percent) ? percent : undefined, processed, total });
      lastProgressSentAtRef.current = Date.now();
      pendingStateRef.current = null;
    };
    const scheduleProgress = () => {
      if (throttleTimeoutRef.current != null) return;
      const delta = Date.now() - lastProgressSentAtRef.current;
      const wait = delta >= THROTTLE_MS ? 0 : (THROTTLE_MS - delta);
      throttleTimeoutRef.current = window.setTimeout(() => {
        throttleTimeoutRef.current = null;
        flushProgress();
      }, wait) as unknown as number;
    };

    const onPackState = (e: Event) => {
      try {
        const id = currentJobIdRef.current;
        if (!id) return;
        const detail = (e as CustomEvent).detail as {
          status: string;
          processed?: number;
          total?: number;
          percent?: number;
          tokenEstimate?: number;
          fullContent?: string;
          contentForDisplay?: string;
          message?: string;
        };
        switch (detail.status) {
          case 'packing': {
            // Throttle progress updates
            pendingStateRef.current = {
              processed: detail.processed ?? 0,
              total: detail.total ?? 0,
              percent: detail.percent ?? 0,
            };
            scheduleProgress();
            break;
          }
          case 'ready': {
            if (sentTerminalRef.current) return;
            const content = detail.fullContent ?? '';
            const fileCount = typeof detail.total === 'number' ? detail.total : undefined;
            ipc.send("cli-pack-content", { id, content, fileCount });
            sentTerminalRef.current = true;
            // eslint-disable-next-line no-console
            console.log('[CLI_PACK] ready', { id, fileCount });
            break;
          }
          case 'error': {
            if (sentTerminalRef.current) return;
            ipc.send("cli-pack-status", { id, state: 'FAILED', message: detail.message || 'Unknown error' });
            sentTerminalRef.current = true;
            // eslint-disable-next-line no-console
            console.log('[CLI_PACK] error', { id, message: detail.message });
            break;
          }
          case 'cancelled': {
            if (sentTerminalRef.current) return;
            ipc.send("cli-pack-status", { id, state: 'CANCELLED' });
            sentTerminalRef.current = true;
            // eslint-disable-next-line no-console
            console.log('[CLI_PACK] cancelled', { id });
            break;
          }
          default: {
            break;
          }
        }
      } catch {
        // ignore
      }
    };

    // Register IPC listeners
    ipc.on("cli-pack-start", handleStart);
    ipc.on("cli-pack-cancel", handleCancel);

    // Register DOM listeners from ContentArea
    window.addEventListener('pf-pack-state', onPackState as EventListener);

    return () => {
      try { ipc.removeListener("cli-pack-start", handleStart as any); } catch {}
      try { ipc.removeListener("cli-pack-cancel", handleCancel as any); } catch {}
      try { window.removeEventListener('pf-pack-state', onPackState as EventListener); } catch {}
    };
  }, []);

  return null;
}
