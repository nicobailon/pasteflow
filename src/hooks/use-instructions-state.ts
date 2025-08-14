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
      const result = await window.electron.ipcRenderer.invoke('/instructions/list', {});
      setInstructions(result);
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to fetch instructions:', error_);
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
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to create instruction:', error_);
      throw error_;
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
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to update instruction:', error_);
      throw error_;
    }
  }, [fetchInstructions]);

  const deleteInstruction = useCallback(async (id: string) => {
    try {
      await window.electron.ipcRenderer.invoke('/instructions/delete', { id });
      await fetchInstructions();
    } catch (error_) {
      setError(error_ as Error);
      console.error('Failed to delete instruction:', error_);
      throw error_;
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