import { useCallback, useState } from 'react';
import { STORAGE_KEYS } from '@constants';

import { RolePrompt, SystemPrompt } from '../types/file-types';

import { usePersistentState } from './use-persistent-state';

/**
 * Custom hook to manage system and role prompts
 * 
 * @returns {Object} System and role prompts state and functions
 */
const usePromptState = () => {
  // System prompts state
  const [systemPrompts, setSystemPrompts] = usePersistentState<SystemPrompt[]>(
    STORAGE_KEYS.SYSTEM_PROMPTS,
    []
  );
  const [selectedSystemPrompts, setSelectedSystemPrompts] = useState([] as SystemPrompt[]);
  
  // Role prompts state
  const [rolePrompts, setRolePrompts] = usePersistentState<RolePrompt[]>(
    STORAGE_KEYS.ROLE_PROMPTS,
    []
  );
  const [selectedRolePrompts, setSelectedRolePrompts] = useState([] as RolePrompt[]);

  // System prompts management functions
  const handleAddSystemPrompt = useCallback((prompt: SystemPrompt) => {
    setSystemPrompts([...systemPrompts, prompt]);
  }, [systemPrompts, setSystemPrompts]);

  const handleDeleteSystemPrompt = useCallback((id: string) => {
    setSystemPrompts(systemPrompts.filter(prompt => prompt.id !== id));
    // Also remove from selected prompts if it was selected
    setSelectedSystemPrompts((prev: SystemPrompt[]) => prev.filter((prompt: SystemPrompt) => prompt.id !== id));
  }, [systemPrompts, setSystemPrompts]);

  const handleUpdateSystemPrompt = useCallback((updatedPrompt: SystemPrompt) => {
    setSystemPrompts(systemPrompts.map(prompt => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    ));
    
    // Also update in selected prompts if it was selected
    setSelectedSystemPrompts((prev: SystemPrompt[]) => prev.map((prompt: SystemPrompt) => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    ));
  }, [systemPrompts, setSystemPrompts]);

  const toggleSystemPromptSelection = useCallback((prompt: SystemPrompt) => {
    setSelectedSystemPrompts((prev: SystemPrompt[]) => {
      const isAlreadySelected = prev.some((p: SystemPrompt) => p.id === prompt.id);
      
      return isAlreadySelected
        ? prev.filter((p: SystemPrompt) => p.id !== prompt.id)
        : [...prev, prompt];
    });
  }, []);
  
  // Role prompts management functions
  const handleAddRolePrompt = useCallback((prompt: RolePrompt) => {
    setRolePrompts([...rolePrompts, prompt]);
  }, [rolePrompts, setRolePrompts]);

  const handleDeleteRolePrompt = useCallback((id: string) => {
    setRolePrompts(rolePrompts.filter(prompt => prompt.id !== id));
    // Also remove from selected prompts if it was selected
    setSelectedRolePrompts((prev: RolePrompt[]) => prev.filter((prompt: RolePrompt) => prompt.id !== id));
  }, [rolePrompts, setRolePrompts]);

  const handleUpdateRolePrompt = useCallback((updatedPrompt: RolePrompt) => {
    setRolePrompts(rolePrompts.map(prompt => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    ));
    
    // Also update in selected prompts if it was selected
    setSelectedRolePrompts((prev: RolePrompt[]) => prev.map((prompt: RolePrompt) => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    ));
  }, [rolePrompts, setRolePrompts]);

  const toggleRolePromptSelection = useCallback((prompt: RolePrompt) => {
    setSelectedRolePrompts((prev: RolePrompt[]) => {
      const isAlreadySelected = prev.some((p: RolePrompt) => p.id === prompt.id);
      
      return isAlreadySelected
        ? prev.filter((p: RolePrompt) => p.id !== prompt.id)
        : [...prev, prompt];
    });
  }, []);

  // Get current prompts state for workspace saving
  const getPrompts = () => ({
    systemPrompts: selectedSystemPrompts,
    rolePrompts: selectedRolePrompts,
  });

  // Set prompts state from a workspace
  const setPrompts = (prompts: { systemPrompts: SystemPrompt[]; rolePrompts: RolePrompt[] }) => {
    setSelectedSystemPrompts(prompts.systemPrompts);
    setSelectedRolePrompts(prompts.rolePrompts);
  };

  return {
    // System prompts
    systemPrompts,
    selectedSystemPrompts,
    handleAddSystemPrompt,
    handleDeleteSystemPrompt,
    handleUpdateSystemPrompt,
    toggleSystemPromptSelection,
    
    // Role prompts
    rolePrompts,
    selectedRolePrompts,
    handleAddRolePrompt,
    handleDeleteRolePrompt,
    handleUpdateRolePrompt,
    toggleRolePromptSelection,
    
    // Workspace support
    getPrompts,
    setPrompts
  };
};

export default usePromptState;