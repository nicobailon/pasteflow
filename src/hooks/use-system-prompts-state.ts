import { useCallback, useEffect, useState } from 'react';

import { SystemPrompt } from '../types/file-types';

interface UseSystemPromptsStateReturn {
  systemPrompts: SystemPrompt[];
  loading: boolean;
  error: Error | null;
  fetchSystemPrompts: () => Promise<void>;
  createSystemPrompt: (prompt: SystemPrompt) => Promise<void>;
  updateSystemPrompt: (prompt: SystemPrompt) => Promise<void>;
  deleteSystemPrompt: (id: string) => Promise<void>;
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

export function useSystemPromptsState(): UseSystemPromptsStateReturn {
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSystemPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await window.electron.ipcRenderer.invoke('/system-prompts/list', {});
      const list = unwrapIpc<SystemPrompt[]>(raw);
      setSystemPrompts(Array.isArray(list) ? list : []);
    } catch (error_) {
      setSystemPrompts([]);
      setError(error_ as Error);
      console.error('Failed to fetch system prompts:', error_);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSystemPrompt = useCallback(async (prompt: SystemPrompt) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/system-prompts/create', {
        id: prompt.id,
        name: prompt.name,
        content: prompt.content
      });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Create failed');
      }
      await fetchSystemPrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to create system prompt:', error_);
      throw error_;
    }
  }, [fetchSystemPrompts]);

  const updateSystemPrompt = useCallback(async (prompt: SystemPrompt) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/system-prompts/update', {
        id: prompt.id,
        name: prompt.name,
        content: prompt.content
      });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Update failed');
      }
      await fetchSystemPrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to update system prompt:', error_);
      throw error_;
    }
  }, [fetchSystemPrompts]);

  const deleteSystemPrompt = useCallback(async (id: string) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/system-prompts/delete', { id });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Delete failed');
      }
      await fetchSystemPrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to delete system prompt:', error_);
      throw error_;
    }
  }, [fetchSystemPrompts]);

  useEffect(() => {
    fetchSystemPrompts();

    const handler = () => { void fetchSystemPrompts(); };
    try {
      if (window.electron?.ipcRenderer?.on) {
        window.electron.ipcRenderer.on('system-prompts-updated', handler as unknown as (...args: unknown[]) => void);
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (window.electron?.ipcRenderer?.removeListener) {
          window.electron.ipcRenderer.removeListener('system-prompts-updated', handler as unknown as (...args: unknown[]) => void);
        }
      } catch {
        // ignore
      }
    };
  }, [fetchSystemPrompts]);

  return {
    systemPrompts,
    loading,
    error,
    fetchSystemPrompts,
    createSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt
  };
}
