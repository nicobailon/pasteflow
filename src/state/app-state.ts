import { atom } from 'jotai';

import { SelectedFileWithLines, SystemPrompt, RolePrompt } from '../types/file-types';

export const selectedFilesAtom = atom<SelectedFileWithLines[]>([]);
export const selectedSystemPromptAtom = atom<SystemPrompt | null>(null);
export const selectedRolePromptAtom = atom<RolePrompt | null>(null); 