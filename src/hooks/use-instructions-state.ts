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

export function useInstructionsState(): UseInstructionsStateReturn {
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchInstructions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('/instructions/list');
      setInstructions(result);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch instructions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createInstruction = useCallback(async (instruction: Instruction) => {
    try {
      await window.electron.ipcRenderer.invoke('/instructions/create', {
        id: instruction.id,
        name: instruction.name,
        content: instruction.content
      });
      await fetchInstructions();
    } catch (err) {
      setError(err as Error);
      console.error('Failed to create instruction:', err);
      throw err;
    }
  }, [fetchInstructions]);

  const updateInstruction = useCallback(async (instruction: Instruction) => {
    try {
      await window.electron.ipcRenderer.invoke('/instructions/update', {
        id: instruction.id,
        name: instruction.name,
        content: instruction.content
      });
      await fetchInstructions();
    } catch (err) {
      setError(err as Error);
      console.error('Failed to update instruction:', err);
      throw err;
    }
  }, [fetchInstructions]);

  const deleteInstruction = useCallback(async (id: string) => {
    try {
      await window.electron.ipcRenderer.invoke('/instructions/delete', { id });
      await fetchInstructions();
    } catch (err) {
      setError(err as Error);
      console.error('Failed to delete instruction:', err);
      throw err;
    }
  }, [fetchInstructions]);

  useEffect(() => {
    fetchInstructions();
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