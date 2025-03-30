import React from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';

import '@testing-library/jest-dom';
import { SystemPrompt } from '../types/FileTypes';

import { mockDateNow } from './testHelpers';

// Mock the Radix Dialog components
jest.mock('@radix-ui/react-dialog', () => {
  return {
    __esModule: true,
    Root: ({ open, onOpenChange, children }: any) => {
      if (!open) return null;
      return <div data-testid="dialog-root">{children}</div>;
    },
    Portal: ({ children }: any) => <div data-testid="dialog-portal">{children}</div>,
    Overlay: () => <div data-testid="dialog-overlay" />,
    Content: ({ children, className }: any) => (
      <div data-testid="modal" aria-modal="true" className={className}>
        {children}
      </div>
    ),
    Title: ({ asChild, children }: any) => (
      <div data-testid="dialog-title">{asChild ? children : <h2>{children}</h2>}</div>
    ),
    Description: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
    Close: ({ asChild, children }: any) => (
      <div data-testid="dialog-close">{asChild ? children : <button>{children}</button>}</div>
    )
  };
});

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  Plus: () => <div data-testid="plus-icon" />,
  Trash: () => <div data-testid="trash-icon" />,
  Edit: () => <div data-testid="edit-icon" />,
  Clipboard: () => <div data-testid="clipboard-icon" />,
  Check: () => <div data-testid="check-icon" />,
  Pencil: () => <div data-testid="pencil-icon" />,
  CirclePlus: () => <div data-testid="circle-plus-icon" />,
  X: () => <>×</>
}));

// Now import SystemPromptsModal after mocking
import SystemPromptsModal from '../components/SystemPromptsModal';

describe('SystemPromptsModal Component', () => {
  // Test data
  const mockSystemPrompts: SystemPrompt[] = [
    {
      id: '1',
      title: 'Test Prompt 1',
      content: 'This is a test system prompt content 1'
    },
    {
      id: '2',
      title: 'Test Prompt 2',
      content: 'This is a test system prompt content 2'
    }
  ];
  
  const mockSelectedSystemPrompts: SystemPrompt[] = [mockSystemPrompts[0]];
  
  // Mock functions
  const mockOnClose = jest.fn();
  const mockOnAddPrompt = jest.fn();
  const mockOnDeletePrompt = jest.fn();
  const mockOnUpdatePrompt = jest.fn();
  const mockOnSelectPrompt = jest.fn();
  const mockToggleSystemPromptSelection = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders correctly when open with system prompts', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Check modal is rendered
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    
    // Check title is rendered
    expect(screen.getByText('System Prompts')).toBeInTheDocument();
    
    // Check prompts are listed
    expect(screen.getByText('Test Prompt 1')).toBeInTheDocument();
    expect(screen.getByText('Test Prompt 2')).toBeInTheDocument();
    
    // Check close button exists
    expect(screen.getByText('×')).toBeInTheDocument();
    
    // Check form for adding new prompts exists
    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter prompt title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter prompt content')).toBeInTheDocument();
  });
  
  it('does not render when closed', () => {
    render(
      <SystemPromptsModal
        isOpen={false}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Modal should not be in the document
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });
  
  it('calls onClose when close button is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Click close button
    fireEvent.click(screen.getByText('×'));
    
    // Check if onClose was called
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
  
  it('adds a new prompt when add prompt button is clicked', () => {
    // Use the safer mock implementation with cleanup
    const cleanupDateNow = mockDateNow(12_345);
    
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Enter title and content
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    
    fireEvent.change(titleInput, { target: { value: 'New Prompt Title' } });
    fireEvent.change(contentInput, { target: { value: 'New Prompt Content' } });
    
    // Find and click add button
    const addButton = screen.getByText('Add Prompt');
    fireEvent.click(addButton);
    
    // Check if onAddPrompt was called with correct data
    expect(mockOnAddPrompt).toHaveBeenCalledTimes(1);
    expect(mockOnAddPrompt).toHaveBeenCalledWith({
      id: '12345',
      title: 'New Prompt Title',
      content: 'New Prompt Content'
    });
    
    // Clean up the Date.now mock
    cleanupDateNow();
  });
  
  it('does not add a prompt if title or content is empty', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Enter only title (no content)
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    fireEvent.change(titleInput, { target: { value: 'New Prompt Title' } });
    
    // Add button should be disabled
    const addButton = screen.getByText('Add Prompt');
    expect(addButton.closest('button')).toBeDisabled();
    
    // Click add button (should not work)
    fireEvent.click(addButton);
    
    // Check if onAddPrompt was not called
    expect(mockOnAddPrompt).not.toHaveBeenCalled();
    
    // Now enter content but clear title
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    fireEvent.change(contentInput, { target: { value: 'New Prompt Content' } });
    fireEvent.change(titleInput, { target: { value: '' } });
    
    // Add button should still be disabled
    expect(addButton.closest('button')).toBeDisabled();
    
    // Click add button (should not work)
    fireEvent.click(addButton);
    
    // Check if onAddPrompt was not called
    expect(mockOnAddPrompt).not.toHaveBeenCalled();
  });
  
  it('deletes a prompt when delete button is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Find the first prompt item
    const promptItems = screen.getAllByText(/Test Prompt/);
    expect(promptItems).toHaveLength(2);
    
    // Find and hover over the prompt item to show actions
    const firstPromptItem = promptItems[0].closest('.system-prompt-item');
    
    // Find the delete button in the actions div (using testid)
    const deleteButtons = screen.getAllByTestId('trash-icon');
    expect(deleteButtons).toHaveLength(2);
    
    // Click the first delete button
    fireEvent.click(deleteButtons[0]);
    
    // Check if onDeletePrompt was called with correct prompt id
    expect(mockOnDeletePrompt).toHaveBeenCalledTimes(1);
    expect(mockOnDeletePrompt).toHaveBeenCalledWith('1');
  });
  
  it('shows edit form when edit button is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Initially, we should see the "Add New System Prompt" form
    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
    
    // Find and click the edit button for the first prompt
    const editButtons = screen.getAllByTestId('pencil-icon');
    fireEvent.click(editButtons[0]);
    
    // Now we should see the edit form
    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();
    
    // Check if the form is pre-filled with the prompt data
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    
    expect(titleInput).toHaveValue('Test Prompt 1');
    expect(contentInput).toHaveValue('This is a test system prompt content 1');
  });

  it('updates a prompt when update button is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Get into edit mode
    const editButtons = screen.getAllByTestId('pencil-icon');
    fireEvent.click(editButtons[0]);
    
    // Edit the prompt data
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    
    fireEvent.change(titleInput, { target: { value: 'Updated Prompt Title' } });
    fireEvent.change(contentInput, { target: { value: 'Updated Prompt Content' } });
    
    // Find and click update button
    const updateButton = screen.getByText('Update Prompt');
    fireEvent.click(updateButton);
    
    // Check if onUpdatePrompt was called with updated data
    expect(mockOnUpdatePrompt).toHaveBeenCalledTimes(1);
    expect(mockOnUpdatePrompt).toHaveBeenCalledWith({
      id: '1',
      title: 'Updated Prompt Title',
      content: 'Updated Prompt Content'
    });
    
    // After update, we should see the "Add New System Prompt" form again
    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
  });
  
  it('cancels editing a prompt when cancel button is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Find and click the edit button for the first prompt
    const editButtons = screen.getAllByTestId('pencil-icon');
    fireEvent.click(editButtons[0]);
    
    // Now we should see the edit form
    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();
    
    // Find and click cancel button
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    // After cancel, we should see the "Add New System Prompt" form again
    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
    
    // Check that onUpdatePrompt was not called
    expect(mockOnUpdatePrompt).not.toHaveBeenCalled();
  });
  
  it('toggles selection when a prompt is clicked', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Find all prompt items
    const promptItems = screen.getAllByText(/Test Prompt/);
    
    // Click the second prompt item (which is not selected)
    fireEvent.click(promptItems[1]);
    
    // Check if toggleSystemPromptSelection was called with the correct prompt
    expect(mockToggleSystemPromptSelection).toHaveBeenCalledTimes(1);
    expect(mockToggleSystemPromptSelection).toHaveBeenCalledWith(mockSystemPrompts[1]);
  });
  
  it('displays a message when no prompts exist', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={[]}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={[]}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Check for the no prompts message
    expect(screen.getByText('No system prompts yet. Add one to get started.')).toBeInTheDocument();
  });
  
  // Error handling tests
  it('shows validation error when trying to update with empty fields', () => {
    // Initialize component in edit mode
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Get into edit mode
    const editButtons = screen.getAllByTestId('pencil-icon');
    fireEvent.click(editButtons[0]);
    
    // Clear the input fields
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.change(contentInput, { target: { value: '' } });
    
    // Update button should be disabled
    const updateButton = screen.getByText('Update Prompt');
    expect(updateButton.closest('button')).toBeDisabled();
    
    // onUpdatePrompt should not be called if we click it
    fireEvent.click(updateButton);
    expect(mockOnUpdatePrompt).not.toHaveBeenCalled();
  });
  
  it('handles very long titles and contents properly', () => {
    render(
      <SystemPromptsModal
        isOpen={true}
        onClose={mockOnClose}
        systemPrompts={mockSystemPrompts}
        onAddPrompt={mockOnAddPrompt}
        onDeletePrompt={mockOnDeletePrompt}
        onUpdatePrompt={mockOnUpdatePrompt}
        onSelectPrompt={mockOnSelectPrompt}
        selectedSystemPrompts={mockSelectedSystemPrompts}
        toggleSystemPromptSelection={mockToggleSystemPromptSelection}
      />
    );
    
    // Create long text values
    const longTitle = 'A'.repeat(100);
    const longContent = 'B'.repeat(1000);
    
    // Enter long title and content
    const titleInput = screen.getByPlaceholderText('Enter prompt title');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');
    
    fireEvent.change(titleInput, { target: { value: longTitle } });
    fireEvent.change(contentInput, { target: { value: longContent } });
    
    // Form should still be valid
    const addButton = screen.getByText('Add Prompt');
    expect(addButton.closest('button')).not.toBeDisabled();
    
    // Mock Date.now with cleanup
    const cleanupDateNow = mockDateNow(12_345);
    
    // Add the prompt
    fireEvent.click(addButton);
    
    // Check if onAddPrompt was called with long values
    expect(mockOnAddPrompt).toHaveBeenCalledTimes(1);
    expect(mockOnAddPrompt).toHaveBeenCalledWith({
      id: '12345',
      title: longTitle,
      content: longContent
    });
    
    // Clean up
    cleanupDateNow();
  });
}); 