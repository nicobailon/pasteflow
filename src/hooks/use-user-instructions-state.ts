import { useCallback, useEffect, useState } from 'react';

interface UseUserInstructionsStateReturn {
  userInstructions: string;
  loading: boolean;
  error: Error | null;
  fetchUserInstructions: () => Promise<void>;
  setUserInstructions: (content: string) => Promise<void>;
}

function unwrapIpc<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'success' in res) {
    if ((res as { success: boolean }).success !== true) {
      throw new Error((res as { error?: string }).error || 'IPC request failed');
    }
    return (res as { data: T }).data;
  }
  return res as T;
}

export function useUserInstructionsState(): UseUserInstructionsStateReturn {
  const [userInstructions, setUserInstructionsState] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchUserInstructions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await window.electron.ipcRenderer.invoke('/user-instructions/get', {});
      const data = unwrapIpc<{ content: string }>(raw);
      setUserInstructionsState(data?.content ?? '');
    } catch (error_) {
      setUserInstructionsState('');
      setError(error_ as Error);
      console.error('Failed to fetch user instructions:', error_);
    } finally {
      setLoading(false);
    }
  }, []);

  const setUserInstructions = useCallback(async (content: string) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/user-instructions/set', { content });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Set failed');
      }
      setUserInstructionsState(content);
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to set user instructions:', error_);
      throw error_;
    }
  }, []);

  useEffect(() => {
    fetchUserInstructions();

    const handler = () => { void fetchUserInstructions(); };
    try {
      if (window.electron?.ipcRenderer?.on) {
        window.electron.ipcRenderer.on('user-instructions-updated', handler as unknown as (...args: unknown[]) => void);
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (window.electron?.ipcRenderer?.removeListener) {
          window.electron.ipcRenderer.removeListener('user-instructions-updated', handler as unknown as (...args: unknown[]) => void);
        }
      } catch {
        // ignore
      }
    };
  }, [fetchUserInstructions]);

  return {
    userInstructions,
    loading,
    error,
    fetchUserInstructions,
    setUserInstructions
  };
}
