import { useState, useCallback } from 'react';
import { SystemPrompt, RolePrompt } from '../types/FileTypes';
import useLocalStorage from './useLocalStorage';
import { STORAGE_KEYS } from '../constants';

/**
 * Custom hook to manage system and role prompts
 * 
 * @returns {Object} System and role prompts state and functions
 */
const usePromptState = () => {
  // System prompts state
  const [systemPrompts, setSystemPrompts] = useLocalStorage<SystemPrompt[]>(
    STORAGE_KEYS.SYSTEM_PROMPTS,
    []
  );
  const [selectedSystemPrompts, setSelectedSystemPrompts] = useState<SystemPrompt[]>([]);
  
  // Role prompts state
  const [rolePrompts, setRolePrompts] = useLocalStorage<RolePrompt[]>(
    STORAGE_KEYS.ROLE_PROMPTS,
    []
  );
  const [selectedRolePrompts, setSelectedRolePrompts] = useState<RolePrompt[]>([]);

  // System prompts management functions
  const handleAddSystemPrompt = useCallback((prompt: SystemPrompt) => {
    setSystemPrompts([...systemPrompts, prompt]);
  }, [systemPrompts, setSystemPrompts]);

  const handleDeleteSystemPrompt = useCallback((id: string) => {
    setSystemPrompts(systemPrompts.filter(prompt => prompt.id !== id));
    // Also remove from selected prompts if it was selected
    setSelectedSystemPrompts((prev: SystemPrompt[]) => prev.filter(prompt => prompt.id !== id));
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
      const isAlreadySelected = prev.some(p => p.id === prompt.id);
      
      if (isAlreadySelected) {
        // Remove prompt if already selected
        return prev.filter(p => p.id !== prompt.id);
      } else {
        // Add prompt if not already selected
        return [...prev, prompt];
      }
    });
  }, []);
  
  // Role prompts management functions
  const handleAddRolePrompt = useCallback((prompt: RolePrompt) => {
    setRolePrompts([...rolePrompts, prompt]);
  }, [rolePrompts, setRolePrompts]);

  const handleDeleteRolePrompt = useCallback((id: string) => {
    setRolePrompts(rolePrompts.filter(prompt => prompt.id !== id));
    // Also remove from selected prompts if it was selected
    setSelectedRolePrompts((prev: RolePrompt[]) => prev.filter(prompt => prompt.id !== id));
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
      const isAlreadySelected = prev.some(p => p.id === prompt.id);
      
      if (isAlreadySelected) {
        // Remove prompt if already selected
        return prev.filter(p => p.id !== prompt.id);
      } else {
        // Add prompt if not already selected
        return [...prev, prompt];
      }
    });
  }, []);

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
    toggleRolePromptSelection
  };
};

export default usePromptState;