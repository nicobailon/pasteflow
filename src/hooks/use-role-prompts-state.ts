import { useCallback, useEffect, useState } from 'react';

import { RolePrompt } from '../types/file-types';

interface UseRolePromptsStateReturn {
  rolePrompts: RolePrompt[];
  loading: boolean;
  error: Error | null;
  fetchRolePrompts: () => Promise<void>;
  createRolePrompt: (prompt: RolePrompt) => Promise<void>;
  updateRolePrompt: (prompt: RolePrompt) => Promise<void>;
  deleteRolePrompt: (id: string) => Promise<void>;
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

export function useRolePromptsState(): UseRolePromptsStateReturn {
  const [rolePrompts, setRolePrompts] = useState<RolePrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchRolePrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await window.electron.ipcRenderer.invoke('/role-prompts/list', {});
      const list = unwrapIpc<RolePrompt[]>(raw);
      setRolePrompts(Array.isArray(list) ? list : []);
    } catch (error_) {
      setRolePrompts([]);
      setError(error_ as Error);
      console.error('Failed to fetch role prompts:', error_);
    } finally {
      setLoading(false);
    }
  }, []);

  const createRolePrompt = useCallback(async (prompt: RolePrompt) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/role-prompts/create', {
        id: prompt.id,
        name: prompt.name,
        content: prompt.content
      });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Create failed');
      }
      await fetchRolePrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to create role prompt:', error_);
      throw error_;
    }
  }, [fetchRolePrompts]);

  const updateRolePrompt = useCallback(async (prompt: RolePrompt) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/role-prompts/update', {
        id: prompt.id,
        name: prompt.name,
        content: prompt.content
      });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Update failed');
      }
      await fetchRolePrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to update role prompt:', error_);
      throw error_;
    }
  }, [fetchRolePrompts]);

  const deleteRolePrompt = useCallback(async (id: string) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/role-prompts/delete', { id });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as { success: boolean }).success) {
        throw new Error((raw as { error?: string }).error || 'Delete failed');
      }
      await fetchRolePrompts();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to delete role prompt:', error_);
      throw error_;
    }
  }, [fetchRolePrompts]);

  useEffect(() => {
    fetchRolePrompts();

    const handler = () => { void fetchRolePrompts(); };
    try {
      if (window.electron?.ipcRenderer?.on) {
        window.electron.ipcRenderer.on('role-prompts-updated', handler as unknown as (...args: unknown[]) => void);
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (window.electron?.ipcRenderer?.removeListener) {
          window.electron.ipcRenderer.removeListener('role-prompts-updated', handler as unknown as (...args: unknown[]) => void);
        }
      } catch {
        // ignore
      }
    };
  }, [fetchRolePrompts]);

  return {
    rolePrompts,
    loading,
    error,
    fetchRolePrompts,
    createRolePrompt,
    updateRolePrompt,
    deleteRolePrompt
  };
}
