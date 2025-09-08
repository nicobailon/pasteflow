import { useEffect, useState, useCallback } from "react";

export interface UseAgentProviderStatusResult {
  readonly hasOpenAIKey: boolean | null;
  checkKeyPresence: () => Promise<boolean>;
}

export default function useAgentProviderStatus(): UseAgentProviderStatusResult {
  const [hasOpenAIKey, setHasOpenAIKey] = useState<boolean | null>(null);

  const checkKeyPresence = useCallback(async (): Promise<boolean> => {
    try {
      const res: unknown = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openai.apiKey' });
      const value = (res && typeof res === 'object' && 'success' in (res as any)) ? (res as any).data : res;
      const has = Boolean(value && (
        (typeof value === 'string' && (value as string).trim().length > 0) ||
        (value && typeof value === 'object' && (value as any).__type === 'secret' && (value as any).v === 1)
      ));
      setHasOpenAIKey(has);
      return has;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void checkKeyPresence();
    const cb = (_: unknown) => { void checkKeyPresence(); };
    try {
      (window as any).electron?.receive?.('/prefs/get:update', cb as any);
    } catch { /* noop */ }
    return () => {
      try { (window as any).electron?.ipcRenderer?.removeListener?.('/prefs/get:update', cb as any); } catch { /* noop */ }
    };
  }, [checkKeyPresence]);

  return { hasOpenAIKey, checkKeyPresence };
}

