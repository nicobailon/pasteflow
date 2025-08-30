import { useCallback, useEffect, useState } from 'react';

import { Instruction } from '../types/file-types';

interface UseInstructionsStateReturn {
  instructions: Instruction[];
  loading: boolean;
  error: Error | null;
  fetchInstructions: () => Promise<void>;
  createInstruction: (instruction: Instruction) => Promise<void>;
  updateInstruction: (instruction: Instruction) => Promise<void>;
  deleteInstruction: (id: string) => Promise<void>;
}

// Envelope-unwrapping helper compatible with legacy raw values
function unwrapIpc<T>(res: any): T {
  if (res && typeof res === 'object' && 'success' in res) {
    if ((res as any).success !== true) {
      throw new Error((res as any).error || 'IPC request failed');
    }
    return (res as any).data as T;
  }
  return res as T;
}

export function useInstructionsState(): UseInstructionsStateReturn {
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchInstructions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await window.electron.ipcRenderer.invoke('/instructions/list', {});
      const list = unwrapIpc<Instruction[]>(raw);
      setInstructions(Array.isArray(list) ? list : []);
    } catch (error_) {
      setInstructions([]); // fail-safe to keep UI stable
      setError(error_ as Error);
      console.error('Failed to fetch instructions:', error_);
    } finally {
      setLoading(false);
    }
  }, []);

  const createInstruction = useCallback(async (instruction: Instruction) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/instructions/create', {
        id: instruction.id,
        name: instruction.name,
        content: instruction.content
      });
      // Ensure success (accept legacy true as well)
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as any).success) throw new Error((raw as any).error || 'Create failed');
      await fetchInstructions();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to create instruction:', error_);
      throw error_;
    }
  }, [fetchInstructions]);

  const updateInstruction = useCallback(async (instruction: Instruction) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/instructions/update', {
        id: instruction.id,
        name: instruction.name,
        content: instruction.content
      });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as any).success) throw new Error((raw as any).error || 'Update failed');
      await fetchInstructions();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to update instruction:', error_);
      throw error_;
    }
  }, [fetchInstructions]);

  const deleteInstruction = useCallback(async (id: string) => {
    try {
      const raw = await window.electron.ipcRenderer.invoke('/instructions/delete', { id });
      if (raw && typeof raw === 'object' && 'success' in raw && !(raw as any).success) throw new Error((raw as any).error || 'Delete failed');
      await fetchInstructions();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to delete instruction:', error_);
      throw error_;
    }
  }, [fetchInstructions]);

  useEffect(() => {
    fetchInstructions();

    // Subscribe to external updates (e.g., CLI changes via HTTP API)
    const handler = () => { void fetchInstructions(); };
    try {
      if (window.electron?.ipcRenderer?.on) {
        window.electron.ipcRenderer.on('instructions-updated', handler as unknown as (...args: unknown[]) => void);
      }
    } catch {
      // ignore subscription errors silently
    }

    return () => {
      try {
        if (window.electron?.ipcRenderer?.removeListener) {
          window.electron.ipcRenderer.removeListener('instructions-updated', handler as unknown as (...args: unknown[]) => void);
        }
      } catch {
        // ignore cleanup errors
      }
    };
  }, [fetchInstructions]);

  return {
    instructions,
    loading,
    error,
    fetchInstructions,
    createInstruction,
    updateInstruction,
    deleteInstruction
  };
}
