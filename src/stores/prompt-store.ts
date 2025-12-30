import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { SystemPrompt, RolePrompt, Doc, Instruction } from '../types/file-types';

interface PromptState {
  selectedSystemPrompts: SystemPrompt[];
  selectedRolePrompts: RolePrompt[];
  docs: Doc[];
  selectedDocs: Doc[];
  instructions: Instruction[];
  selectedInstructions: Instruction[];
  userInstructions: string;
}

interface PromptActions {
  toggleSystemPromptSelection: (prompt: SystemPrompt) => void;
  setSelectedSystemPrompts: (prompts: SystemPrompt[]) => void;

  toggleRolePromptSelection: (prompt: RolePrompt) => void;
  setSelectedRolePrompts: (prompts: RolePrompt[]) => void;

  addDoc: (doc: Doc) => void;
  deleteDoc: (id: string) => void;
  updateDoc: (doc: Doc) => void;
  toggleDocSelection: (doc: Doc) => void;
  setSelectedDocs: (docs: Doc[]) => void;

  addInstruction: (instruction: Instruction) => void;
  deleteInstruction: (id: string) => void;
  updateInstruction: (instruction: Instruction) => void;
  toggleInstructionSelection: (instruction: Instruction) => void;
  setSelectedInstructions: (instructions: Instruction[]) => void;
  setInstructions: (instructions: Instruction[]) => void;

  setUserInstructions: (text: string) => void;

  clearAllSelections: () => void;
  getPromptsSnapshot: () => { systemPrompts: SystemPrompt[]; rolePrompts: RolePrompt[] };
  restorePromptsSnapshot: (snapshot: { systemPrompts: SystemPrompt[]; rolePrompts: RolePrompt[] }) => void;
}

export const usePromptStore = create<PromptState & PromptActions>()(
  persist(
    (set, get) => ({
      selectedSystemPrompts: [],
      selectedRolePrompts: [],
      docs: [],
      selectedDocs: [],
      instructions: [],
      selectedInstructions: [],
      userInstructions: '',

      toggleSystemPromptSelection: (prompt) => set((s) => {
        const isSelected = s.selectedSystemPrompts.some((p) => p.id === prompt.id);
        return {
          selectedSystemPrompts: isSelected
            ? s.selectedSystemPrompts.filter((p) => p.id !== prompt.id)
            : [...s.selectedSystemPrompts, prompt],
        };
      }),
      setSelectedSystemPrompts: (prompts) => set({ selectedSystemPrompts: prompts }),

      toggleRolePromptSelection: (prompt) => set((s) => {
        const isSelected = s.selectedRolePrompts.some((p) => p.id === prompt.id);
        return {
          selectedRolePrompts: isSelected
            ? s.selectedRolePrompts.filter((p) => p.id !== prompt.id)
            : [...s.selectedRolePrompts, prompt],
        };
      }),
      setSelectedRolePrompts: (prompts) => set({ selectedRolePrompts: prompts }),

      addDoc: (doc) => set((s) => ({ docs: [...s.docs, doc] })),
      deleteDoc: (id) => set((s) => ({
        docs: s.docs.filter((d) => d.id !== id),
        selectedDocs: s.selectedDocs.filter((d) => d.id !== id),
      })),
      updateDoc: (doc) => set((s) => ({
        docs: s.docs.map((d) => (d.id === doc.id ? doc : d)),
        selectedDocs: s.selectedDocs.map((d) => (d.id === doc.id ? doc : d)),
      })),
      toggleDocSelection: (doc) => set((s) => {
        const isSelected = s.selectedDocs.some((d) => d.id === doc.id);
        return {
          selectedDocs: isSelected
            ? s.selectedDocs.filter((d) => d.id !== doc.id)
            : [...s.selectedDocs, doc],
        };
      }),
      setSelectedDocs: (docs) => set({ selectedDocs: docs }),

      addInstruction: (instruction) => set((s) => ({ instructions: [...s.instructions, instruction] })),
      deleteInstruction: (id) => set((s) => ({
        instructions: s.instructions.filter((i) => i.id !== id),
        selectedInstructions: s.selectedInstructions.filter((i) => i.id !== id),
      })),
      updateInstruction: (instruction) => set((s) => ({
        instructions: s.instructions.map((i) => (i.id === instruction.id ? instruction : i)),
        selectedInstructions: s.selectedInstructions.map((i) => (i.id === instruction.id ? instruction : i)),
      })),
      toggleInstructionSelection: (instruction) => set((s) => {
        const isSelected = s.selectedInstructions.some((i) => i.id === instruction.id);
        return {
          selectedInstructions: isSelected
            ? s.selectedInstructions.filter((i) => i.id !== instruction.id)
            : [...s.selectedInstructions, instruction],
        };
      }),
      setSelectedInstructions: (instructions) => set({ selectedInstructions: instructions }),
      setInstructions: (instructions) => set({ instructions }),

      setUserInstructions: (text) => set({ userInstructions: text }),

      clearAllSelections: () => set({
        selectedSystemPrompts: [],
        selectedRolePrompts: [],
        selectedDocs: [],
        selectedInstructions: [],
      }),

      getPromptsSnapshot: () => {
        const s = get();
        return { systemPrompts: s.selectedSystemPrompts, rolePrompts: s.selectedRolePrompts };
      },

      restorePromptsSnapshot: (snapshot) => set({
        selectedSystemPrompts: snapshot.systemPrompts,
        selectedRolePrompts: snapshot.rolePrompts,
      }),
    }),
    {
      name: 'pasteflow-prompts',
      partialize: (state) => ({
        docs: state.docs,
      }),
    }
  )
);
