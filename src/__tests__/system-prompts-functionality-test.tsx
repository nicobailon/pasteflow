import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../index';
import { STORAGE_KEYS } from '../constants';
import { setupMockLocalStorage } from './test-helpers';
import { SystemPrompt } from '../types/file-types';

// Minimal mocks for external dependencies only
jest.mock('../handlers/electron-handlers', () => ({
  openFolder: jest.fn().mockResolvedValue('/test/folder'),
  openFolderDialog: jest.fn().mockResolvedValue(null),
  getFilesByPath: jest.fn().mockResolvedValue([]),
  getDirectoryStats: jest.fn().mockResolvedValue({
    totalFiles: 0,
    directoryCount: 0,
    totalSize: 0,
    binaryFiles: []
  }),
  requestFileContent: jest.fn().mockResolvedValue({
    content: 'test content',
    isBinary: false
  }),
  cancelFileLoading: jest.fn(),
  setupElectronHandlers: jest.fn(() => {
    // Return cleanup function
    return jest.fn();
  })
}));

jest.mock('../components/theme-toggle', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-toggle-mock" />
}));

// Helper function to open system prompts modal
async function openSystemPromptsModal() {
  const systemPromptsButton = screen.getByRole('button', { name: /system prompts/i });
  await userEvent.click(systemPromptsButton);
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
}

// Helper to fill prompt form
async function fillPromptForm(name: string, content: string) {
  const nameInput = screen.getByPlaceholderText(/enter prompt name/i);
  const contentTextarea = screen.getByPlaceholderText(/enter prompt content/i);
  
  await userEvent.clear(nameInput);
  if (name) {
    await userEvent.type(nameInput, name);
  }
  
  await userEvent.clear(contentTextarea);
  if (content) {
    await userEvent.type(contentTextarea, content);
  }
}

// Helper to get stored prompts from localStorage
function getStoredPrompts(): SystemPrompt[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPTS) || '[]');
}

describe('System Prompts Feature - Real Component Integration', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    localStorage.clear();
  });

  describe('Adding System Prompts', () => {
    it('should allow users to add new system prompts through the UI', async () => {
      render(<App />);
      
      await openSystemPromptsModal();
      
      // Verify empty state message
      expect(screen.getByText(/no system prompts yet/i)).toBeInTheDocument();
      
      // Fill in the form
      await fillPromptForm('API Guidelines', 'You are an API design expert. Follow RESTful principles.');
      
      // Submit the form
      const addButton = screen.getByRole('button', { name: /add prompt/i });
      expect(addButton).not.toBeDisabled();
      await userEvent.click(addButton);
      
      // Verify prompt appears in the list
      await waitFor(() => {
        expect(screen.queryByText(/no system prompts yet/i)).not.toBeInTheDocument();
        expect(screen.getByText('API Guidelines')).toBeInTheDocument();
      });
      
      // Verify localStorage persistence
      const stored = getStoredPrompts();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        name: 'API Guidelines',
        content: 'You are an API design expert. Follow RESTful principles.'
      });
      expect(stored[0].id).toBeDefined();
      
      // Verify form is cleared after adding
      expect(screen.getByPlaceholderText(/enter prompt name/i)).toHaveValue('');
      expect(screen.getByPlaceholderText(/enter prompt content/i)).toHaveValue('');
    });

    it('should validate required fields when adding prompts', async () => {
      render(<App />);
      
      await openSystemPromptsModal();
      
      // Try to add with empty fields
      const addButton = screen.getByRole('button', { name: /add prompt/i });
      expect(addButton).toBeDisabled();
      
      // Fill only name
      await fillPromptForm('Test Name', '');
      expect(addButton).toBeDisabled();
      
      // Clear name and fill only content
      const nameInput = screen.getByPlaceholderText(/enter prompt name/i);
      await userEvent.clear(nameInput);
      await userEvent.type(screen.getByPlaceholderText(/enter prompt content/i), 'Test content');
      expect(addButton).toBeDisabled();
      
      // Fill both fields
      await userEvent.type(nameInput, 'Complete Prompt');
      expect(addButton).not.toBeDisabled();
    });

    it('should handle multiple prompts with unique IDs', async () => {
      render(<App />);
      
      await openSystemPromptsModal();
      
      // Add first prompt
      await fillPromptForm('First Prompt', 'First content');
      await userEvent.click(screen.getByRole('button', { name: /add prompt/i }));
      
      // Add second prompt
      await fillPromptForm('Second Prompt', 'Second content');
      await userEvent.click(screen.getByRole('button', { name: /add prompt/i }));
      
      // Verify both prompts exist
      expect(screen.getByText('First Prompt')).toBeInTheDocument();
      expect(screen.getByText('Second Prompt')).toBeInTheDocument();
      
      // Verify unique IDs in storage
      const stored = getStoredPrompts();
      expect(stored).toHaveLength(2);
      expect(stored[0].id).not.toBe(stored[1].id);
    });
  });

  describe('Editing System Prompts', () => {
    it('should allow users to edit existing prompts', async () => {
      // Pre-populate with a prompt
      const existingPrompt: SystemPrompt = {
        id: 'test-1',
        name: 'Original Name',
        content: 'Original content for testing'
      };
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify([existingPrompt]));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Click on the prompt to edit
      const promptItem = screen.getByText('Original Name').closest('[role="button"]');
      await userEvent.click(promptItem!);
      
      // Verify edit form is populated
      const nameInput = screen.getByDisplayValue('Original Name');
      const contentTextarea = screen.getByDisplayValue('Original content for testing');
      expect(nameInput).toBeInTheDocument();
      expect(contentTextarea).toBeInTheDocument();
      
      // Update the values
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Updated Name');
      
      await userEvent.clear(contentTextarea);
      await userEvent.type(contentTextarea, 'Updated content with more details');
      
      // Save the changes
      const updateButton = screen.getByRole('button', { name: /update prompt/i });
      await userEvent.click(updateButton);
      
      // Verify UI updates
      expect(screen.getByText('Updated Name')).toBeInTheDocument();
      expect(screen.queryByText('Original Name')).not.toBeInTheDocument();
      
      // Verify localStorage updates
      const stored = getStoredPrompts();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        id: 'test-1',
        name: 'Updated Name',
        content: 'Updated content with more details'
      });
    });

    it('should cancel editing without saving changes', async () => {
      const existingPrompt: SystemPrompt = {
        id: 'test-1',
        name: 'Original Name',
        content: 'Original content'
      };
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify([existingPrompt]));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Start editing
      const promptItem = screen.getByText('Original Name').closest('[role="button"]');
      await userEvent.click(promptItem!);
      
      // Make changes
      const nameInput = screen.getByDisplayValue('Original Name');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Changed Name');
      
      // Cancel editing
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelButton);
      
      // Verify changes were not saved
      expect(screen.getByText('Original Name')).toBeInTheDocument();
      expect(screen.queryByText('Changed Name')).not.toBeInTheDocument();
      
      const stored = getStoredPrompts();
      expect(stored[0].name).toBe('Original Name');
    });
  });

  describe('Deleting System Prompts', () => {
    it('should delete prompts and update storage', async () => {
      const prompts: SystemPrompt[] = [
        { id: 'test-1', name: 'Prompt 1', content: 'Content 1' },
        { id: 'test-2', name: 'Prompt 2', content: 'Content 2' },
        { id: 'test-3', name: 'Prompt 3', content: 'Content 3' }
      ];
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify(prompts));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Delete the second prompt
      const prompt2 = screen.getByText('Prompt 2').closest('.system-prompt-item') as HTMLElement;
      const deleteButton = within(prompt2).getByTitle(/delete this prompt/i);
      
      await userEvent.click(deleteButton);
      
      // Verify UI update
      expect(screen.queryByText('Prompt 2')).not.toBeInTheDocument();
      expect(screen.getByText('Prompt 1')).toBeInTheDocument();
      expect(screen.getByText('Prompt 3')).toBeInTheDocument();
      
      // Verify storage update
      const stored = getStoredPrompts();
      expect(stored).toHaveLength(2);
      expect(stored.map(p => p.name)).toEqual(['Prompt 1', 'Prompt 3']);
    });

    it('should remove deleted prompts from selection', async () => {
      const prompt: SystemPrompt = {
        id: 'test-1',
        name: 'Selected Prompt',
        content: 'This prompt is selected'
      };
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify([prompt]));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Select the prompt
      const promptItem = screen.getByText('Selected Prompt').closest('.system-prompt-item') as HTMLElement;
      const selectButton = within(promptItem).getByTitle(/add to selection/i);
      await userEvent.click(selectButton);
      
      // Verify selection indicator appears
      expect(screen.getByText(/1/)).toBeInTheDocument();
      
      // Delete the prompt
      const deleteButton = within(promptItem).getByTitle(/delete this prompt/i);
      await userEvent.click(deleteButton);
      
      // Verify selection is cleared
      expect(screen.queryByText(/1/)).not.toBeInTheDocument();
    });
  });

  describe('Selecting System Prompts', () => {
    it('should toggle prompt selection and show count', async () => {
      const prompts: SystemPrompt[] = [
        { id: 'test-1', name: 'Prompt 1', content: 'Content 1' },
        { id: 'test-2', name: 'Prompt 2', content: 'Content 2' }
      ];
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify(prompts));
      
      render(<App />);
      
      // Verify no selection indicator initially
      const systemPromptsButton = screen.getByRole('button', { name: /system prompts/i });
      expect(within(systemPromptsButton).queryByText(/\d+/)).not.toBeInTheDocument();
      
      await openSystemPromptsModal();
      
      // Select first prompt
      const prompt1 = screen.getByText('Prompt 1').closest('.system-prompt-item') as HTMLElement;
      const selectButton1 = within(prompt1).getByTitle(/add to selection/i);
      await userEvent.click(selectButton1);
      
      // Verify selection visual feedback
      expect(prompt1).toHaveClass('selected');
      expect(within(prompt1).getByTitle(/remove from selection/i)).toBeInTheDocument();
      
      // Select second prompt
      const prompt2 = screen.getByText('Prompt 2').closest('.system-prompt-item') as HTMLElement;
      const selectButton2 = within(prompt2).getByTitle(/add to selection/i);
      await userEvent.click(selectButton2);
      
      // Close modal  
      const modal = screen.getByRole('dialog');
      const xIcon = within(modal).getByTestId('x-icon');
      await userEvent.click(xIcon.parentElement!);
      
      // Verify selection count in button
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /system prompts/i });
        expect(within(button).getByText('2')).toBeInTheDocument();
      });
    });

    it('should persist selection across modal open/close', async () => {
      const prompts: SystemPrompt[] = [
        { id: 'test-1', name: 'Persistent Prompt', content: 'Should stay selected' }
      ];
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify(prompts));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Select the prompt
      const promptItem = screen.getByText('Persistent Prompt').closest('.system-prompt-item') as HTMLElement;
      const selectButton = within(promptItem).getByTitle(/add to selection/i);
      await userEvent.click(selectButton);
      
      // Close modal  
      const modal = screen.getByRole('dialog');
      const xIcon = within(modal).getByTestId('x-icon');
      await userEvent.click(xIcon.parentElement!);
      
      // Reopen modal
      await openSystemPromptsModal();
      
      // Verify prompt is still selected
      const reopenedModal = screen.getByRole('dialog');
      const reopenedPrompt = within(reopenedModal).getByText('Persistent Prompt').closest('.system-prompt-item') as HTMLElement;
      expect(reopenedPrompt).toHaveClass('selected');
      expect(within(reopenedPrompt).getByTitle(/remove from selection/i)).toBeInTheDocument();
    });

    it('should update selected prompts when editing', async () => {
      const prompt: SystemPrompt = {
        id: 'test-1',
        name: 'Original Selected',
        content: 'Original content'
      };
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify([prompt]));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Select the prompt
      const promptItem = screen.getByText('Original Selected').closest('.system-prompt-item') as HTMLElement;
      const selectButton = within(promptItem).getByTitle(/add to selection/i);
      await userEvent.click(selectButton);
      
      // Edit the prompt
      await userEvent.click(promptItem);
      
      const nameInput = screen.getByDisplayValue('Original Selected');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Updated Selected');
      
      await userEvent.click(screen.getByRole('button', { name: /update prompt/i }));
      
      // Verify the updated prompt is still selected
      const systemPromptsModal = screen.getByRole('dialog');
      const updatedPrompt = within(systemPromptsModal).getByText('Updated Selected').closest('.system-prompt-item') as HTMLElement;
      expect(updatedPrompt).toHaveClass('selected');
    });
  });

  describe('Preview Functionality', () => {
    it('should show content preview in prompt list', async () => {
      const longContent = 'This is a very long content that should be truncated in the preview to ensure good UI display';
      const prompt: SystemPrompt = {
        id: 'test-1',
        name: 'Long Content Prompt',
        content: longContent
      };
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify([prompt]));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Verify truncated preview
      const preview = screen.getByText(/This is a very long content/);
      expect(preview.textContent).toContain('...');
      expect(preview.textContent).not.toContain('ensure good UI display');
      
      // Verify full content is available when editing
      const promptItem = screen.getByText('Long Content Prompt').closest('[role="button"]');
      await userEvent.click(promptItem!);
      
      const contentTextarea = screen.getByDisplayValue(longContent);
      expect(contentTextarea).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('should support keyboard navigation for prompt items', async () => {
      const prompts: SystemPrompt[] = [
        { id: 'test-1', name: 'Keyboard Nav Test', content: 'Test content' }
      ];
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPTS, JSON.stringify(prompts));
      
      render(<App />);
      await openSystemPromptsModal();
      
      // Focus on prompt item
      const promptItem = screen.getByText('Keyboard Nav Test').closest('[role="button"]') as HTMLElement;
      promptItem.focus();
      
      // Press Enter to edit
      fireEvent.keyDown(promptItem, { key: 'Enter' });
      
      // Verify edit mode is active
      expect(screen.getByDisplayValue('Keyboard Nav Test')).toBeInTheDocument();
      
      // Cancel edit
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
      
      // Press Space to edit
      promptItem.focus();
      fireEvent.keyDown(promptItem, { key: ' ' });
      
      // Verify edit mode is active again
      expect(screen.getByDisplayValue('Keyboard Nav Test')).toBeInTheDocument();
    });
  });
});