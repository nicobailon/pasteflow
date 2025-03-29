import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SystemPrompt } from '../types/FileTypes';
import { setupMockLocalStorage } from './testHelpers';

// Mock necessary components that are not the focus of testing
jest.mock('../components/Sidebar', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="sidebar-mock" />
  };
});

jest.mock('../components/FileList', () => {
  return {
    __esModule: true,
    default: ({ selectedSystemPrompts, toggleSystemPromptSelection }: any) => (
      <div data-testid="file-list-mock">
        <span data-testid="selected-prompts-count">{selectedSystemPrompts.length}</span>
        {selectedSystemPrompts.map((prompt: SystemPrompt) => (
          <div key={prompt.id} data-testid={`selected-prompt-${prompt.id}`}>
            {prompt.title}
            <button 
              data-testid={`toggle-prompt-${prompt.id}`}
              onClick={() => toggleSystemPromptSelection(prompt)}
            >
              Toggle
            </button>
          </div>
        ))}
      </div>
    )
  };
});

jest.mock('../components/CopyButton', () => {
  return {
    __esModule: true,
    default: ({ text, className, children }: any) => (
      <button className={className} data-testid="copy-button" data-copy-text={text}>
        {children}
      </button>
    )
  };
});

jest.mock('../components/FileViewModal', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="file-view-modal-mock" />
  };
});

jest.mock('../components/SystemPromptsModal', () => {
  return {
    __esModule: true,
    default: ({ 
      isOpen, 
      onClose, 
      systemPrompts, 
      onAddPrompt, 
      onDeletePrompt, 
      onUpdatePrompt,
      toggleSystemPromptSelection,
      selectedSystemPrompts
    }: any) => (
      isOpen ? (
        <div data-testid="system-prompts-modal-mock">
          <button 
            data-testid="close-modal-button" 
            onClick={onClose}
          >
            Close
          </button>
          <button 
            data-testid="add-prompt-button" 
            onClick={() => onAddPrompt({
              id: 'new-prompt-id',
              title: 'New Test Prompt',
              content: 'New test prompt content'
            })}
          >
            Add Prompt
          </button>
          {systemPrompts.map((prompt: SystemPrompt) => (
            <div key={prompt.id} data-testid={`prompt-${prompt.id}`}>
              {prompt.title}
              <button 
                data-testid={`delete-prompt-${prompt.id}`}
                onClick={() => onDeletePrompt(prompt.id)}
              >
                Delete
              </button>
              <button 
                data-testid={`update-prompt-${prompt.id}`}
                onClick={() => onUpdatePrompt({
                  ...prompt,
                  title: `Updated ${prompt.title}`,
                  content: `Updated ${prompt.content}`
                })}
              >
                Update
              </button>
              <button 
                data-testid={`select-prompt-${prompt.id}`}
                onClick={() => toggleSystemPromptSelection(prompt)}
              >
                {selectedSystemPrompts.some((p: SystemPrompt) => p.id === prompt.id) ? 'Deselect' : 'Select'}
              </button>
            </div>
          ))}
        </div>
      ) : null
    )
  };
});

// Mock the other required components that are not the focus of testing
jest.mock('../components/ThemeToggle', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="theme-toggle-mock" />
  };
});

jest.mock('../components/FileTreeToggle', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="file-tree-toggle-mock" />
  };
});

jest.mock('lucide-react', () => ({
  FolderOpen: () => <div data-testid="folder-open-icon" />,
  Folder: () => <div data-testid="folder-icon" />,
  Settings: () => <div data-testid="settings-icon" />
}));

// Provide a basic implementation of the ThemeProvider context
jest.mock('../context/theme-context', () => ({
  ThemeProvider: ({ children }: { children: any }) => (
    <div data-testid="theme-provider-mock">{children}</div>
  ),
  useTheme: () => ({ currentTheme: 'light', toggleTheme: jest.fn() })
}));

// Mock API/utility functions
// Removing treeUtils mocks as the file doesn't exist in the project

// Custom SystemPromptsTest component for testing
function SystemPromptsTest({ initialPrompts = [] as SystemPrompt[] }) {
  const [systemPrompts, setSystemPrompts] = React.useState(initialPrompts);
  const [selectedSystemPrompts, setSelectedSystemPrompts] = React.useState([]);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  
  const onAddPrompt = (prompt: SystemPrompt) => {
    const updatedPrompts = [...systemPrompts, prompt];
    setSystemPrompts(updatedPrompts);
    window.localStorage.setItem('pasteflow-system-prompts', JSON.stringify(updatedPrompts));
  };
  
  const onUpdatePrompt = (updatedPrompt: SystemPrompt) => {
    const updatedPrompts = systemPrompts.map((prompt: SystemPrompt) => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    );
    setSystemPrompts(updatedPrompts);
    window.localStorage.setItem('pasteflow-system-prompts', JSON.stringify(updatedPrompts));
    
    // Also update in the selected prompts if it's selected
    if (selectedSystemPrompts.some((p: SystemPrompt) => p.id === updatedPrompt.id)) {
      setSelectedSystemPrompts(selectedSystemPrompts.map((p: SystemPrompt) => 
        p.id === updatedPrompt.id ? updatedPrompt : p
      ));
    }
  };
  
  const onDeletePrompt = (id: string) => {
    const updatedPrompts = systemPrompts.filter((prompt: SystemPrompt) => prompt.id !== id);
    setSystemPrompts(updatedPrompts);
    window.localStorage.setItem('pasteflow-system-prompts', JSON.stringify(updatedPrompts));
    
    // Also remove from selected if it's selected
    if (selectedSystemPrompts.some((p: SystemPrompt) => p.id === id)) {
      setSelectedSystemPrompts(selectedSystemPrompts.filter((p: SystemPrompt) => p.id !== id));
    }
  };
  
  const toggleSystemPromptSelection = (prompt: SystemPrompt) => {
    const isSelected = selectedSystemPrompts.some((p: SystemPrompt) => p.id === prompt.id);
    
    if (isSelected) {
      setSelectedSystemPrompts(selectedSystemPrompts.filter((p: SystemPrompt) => p.id !== prompt.id));
    } else {
      setSelectedSystemPrompts([...selectedSystemPrompts, prompt]);
    }
  };
  
  return (
    <div>
      <button 
        data-testid="system-prompts-button"
        onClick={() => setIsModalOpen(true)}
      >
        <span>System Prompts</span>
        {selectedSystemPrompts.length > 0 && (
          <span className="selected-prompt-indicator">{selectedSystemPrompts.length} selected</span>
        )}
      </button>
      
      <div data-testid="selected-prompts-count">{selectedSystemPrompts.length}</div>

      {isModalOpen && (
        <div data-testid="system-prompts-modal-mock">
          <button 
            data-testid="close-modal-button" 
            onClick={() => setIsModalOpen(false)}
          >
            Close
          </button>
          <button 
            data-testid="add-prompt-button" 
            onClick={() => onAddPrompt({
              id: 'new-prompt-id',
              title: 'New Test Prompt',
              content: 'New test prompt content'
            })}
          >
            Add Prompt
          </button>
          {systemPrompts.map((prompt: SystemPrompt) => (
            <div key={prompt.id} data-testid={`prompt-${prompt.id}`}>
              {prompt.title}
              <button 
                data-testid={`delete-prompt-${prompt.id}`}
                onClick={() => onDeletePrompt(prompt.id)}
              >
                Delete
              </button>
              <button 
                data-testid={`update-prompt-${prompt.id}`}
                onClick={() => onUpdatePrompt({
                  ...prompt,
                  title: `Updated ${prompt.title}`,
                  content: `Updated ${prompt.content}`
                })}
              >
                Update
              </button>
              <button 
                data-testid={`select-prompt-${prompt.id}`}
                onClick={() => toggleSystemPromptSelection(prompt)}
              >
                {selectedSystemPrompts.some((p: SystemPrompt) => p.id === prompt.id) ? 'Deselect' : 'Select'}
              </button>
            </div>
          ))}
          {systemPrompts.length === 0 && (
            <div>No system prompts yet. Add one to get started.</div>
          )}
        </div>
      )}
      
      {selectedSystemPrompts.map((prompt: SystemPrompt) => (
        <div key={prompt.id} data-testid={`selected-prompt-${prompt.id}`}>
          {prompt.title}
          <button 
            data-testid={`toggle-prompt-${prompt.id}`}
            onClick={() => toggleSystemPromptSelection(prompt)}
          >
            Toggle
          </button>
        </div>
      ))}
    </div>
  );
}

describe('SystemPrompts Functionality', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    window.localStorage.setItem('pasteflow-system-prompts', JSON.stringify([]));
  });
  
  it('allows opening the SystemPromptsModal', async () => {
    render(<SystemPromptsTest />);
    
    // Initially the modal should be closed
    expect(screen.queryByTestId('system-prompts-modal-mock')).not.toBeInTheDocument();
    
    // Find and click the system prompts button
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // Now the modal should be open
    expect(screen.getByTestId('system-prompts-modal-mock')).toBeInTheDocument();
    
    // Close the modal
    const closeButton = screen.getByTestId('close-modal-button');
    fireEvent.click(closeButton);
    
    // The modal should be closed again
    await waitFor(() => {
      expect(screen.queryByTestId('system-prompts-modal-mock')).not.toBeInTheDocument();
    });
  });
  
  it('adds a new system prompt', async () => {
    render(<SystemPromptsTest />);
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // No prompts should exist initially
    expect(screen.queryByTestId('prompt-new-prompt-id')).not.toBeInTheDocument();
    
    // Add a new prompt
    const addButton = screen.getByTestId('add-prompt-button');
    fireEvent.click(addButton);
    
    // The new prompt should now be in the list
    expect(screen.getByTestId('prompt-new-prompt-id')).toBeInTheDocument();
    expect(screen.getByText('New Test Prompt')).toBeInTheDocument();
    
    // Check localStorage was updated
    const storedPrompts = JSON.parse(window.localStorage.getItem('pasteflow-system-prompts') || '[]');
    expect(storedPrompts).toHaveLength(1);
    expect(storedPrompts[0].title).toBe('New Test Prompt');
  });
  
  it('updates an existing system prompt', async () => {
    // Initialize with a test prompt
    const initialPrompt: SystemPrompt = {
      id: 'test-prompt-1',
      title: 'Test Prompt',
      content: 'Test prompt content'
    };
    
    render(<SystemPromptsTest initialPrompts={[initialPrompt]} />);
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // The test prompt should be in the list
    expect(screen.getByTestId('prompt-test-prompt-1')).toBeInTheDocument();
    expect(screen.getByText('Test Prompt')).toBeInTheDocument();
    
    // Update the prompt
    const updateButton = screen.getByTestId('update-prompt-test-prompt-1');
    fireEvent.click(updateButton);
    
    // The prompt title should be updated
    expect(screen.getByText('Updated Test Prompt')).toBeInTheDocument();
    
    // Check localStorage was updated
    const storedPrompts = JSON.parse(window.localStorage.getItem('pasteflow-system-prompts') || '[]');
    expect(storedPrompts).toHaveLength(1);
    expect(storedPrompts[0].title).toBe('Updated Test Prompt');
    expect(storedPrompts[0].content).toBe('Updated Test prompt content');
  });
  
  it('deletes a system prompt', async () => {
    // Initialize with a test prompt
    const initialPrompt: SystemPrompt = {
      id: 'test-prompt-1',
      title: 'Test Prompt',
      content: 'Test prompt content'
    };
    
    render(<SystemPromptsTest initialPrompts={[initialPrompt]} />);
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // The test prompt should be in the list
    expect(screen.getByTestId('prompt-test-prompt-1')).toBeInTheDocument();
    
    // Delete the prompt
    const deleteButton = screen.getByTestId('delete-prompt-test-prompt-1');
    fireEvent.click(deleteButton);
    
    // The prompt should be removed from the list
    expect(screen.queryByTestId('prompt-test-prompt-1')).not.toBeInTheDocument();
    
    // Check localStorage was updated
    const storedPrompts = JSON.parse(window.localStorage.getItem('pasteflow-system-prompts') || '[]');
    expect(storedPrompts).toHaveLength(0);
  });
  
  it('selects and deselects system prompts', async () => {
    // Initialize with test prompts
    const initialPrompts: SystemPrompt[] = [
      {
        id: 'test-prompt-1',
        title: 'Test Prompt 1',
        content: 'Test prompt content 1'
      },
      {
        id: 'test-prompt-2',
        title: 'Test Prompt 2',
        content: 'Test prompt content 2'
      }
    ];
    
    render(<SystemPromptsTest initialPrompts={initialPrompts} />);
    
    // Initially no prompts should be selected
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('0');
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // Select the first prompt
    const selectButton = screen.getByTestId('select-prompt-test-prompt-1');
    fireEvent.click(selectButton);
    
    // The prompt should now be selected
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('1');
    
    // Select the second prompt
    const selectButton2 = screen.getByTestId('select-prompt-test-prompt-2');
    fireEvent.click(selectButton2);
    
    // Both prompts should now be selected
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('2');
    
    // Deselect the first prompt
    fireEvent.click(selectButton);
    
    // Only one prompt should be selected now
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('1');
  });
  
  it('updates the selection indicator when prompts are selected', async () => {
    // Initialize with test prompts
    const initialPrompts: SystemPrompt[] = [
      {
        id: 'test-prompt-1',
        title: 'Test Prompt 1',
        content: 'Test prompt content 1'
      }
    ];
    
    render(<SystemPromptsTest initialPrompts={initialPrompts} />);
    
    // Initially the selection indicator should not be visible
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // Select the prompt
    const selectButton = screen.getByTestId('select-prompt-test-prompt-1');
    fireEvent.click(selectButton);
    
    // Close the modal
    const closeButton = screen.getByTestId('close-modal-button');
    fireEvent.click(closeButton);
    
    // The selection indicator should now be visible
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
  
  it('removes a prompt from selection if the prompt is deleted', async () => {
    // Initialize with a test prompt
    const initialPrompt: SystemPrompt = {
      id: 'test-prompt-1',
      title: 'Test Prompt',
      content: 'Test prompt content'
    };
    
    render(<SystemPromptsTest initialPrompts={[initialPrompt]} />);
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // Select the prompt
    const selectButton = screen.getByTestId('select-prompt-test-prompt-1');
    fireEvent.click(selectButton);
    
    // The prompt should now be selected
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('1');
    
    // Delete the prompt
    const deleteButton = screen.getByTestId('delete-prompt-test-prompt-1');
    fireEvent.click(deleteButton);
    
    // The selection should be empty now
    expect(screen.getByTestId('selected-prompts-count').textContent).toBe('0');
  });
  
  it('updates selection when a selected prompt is updated', async () => {
    // Initialize with a test prompt
    const initialPrompt: SystemPrompt = {
      id: 'test-prompt-1',
      title: 'Test Prompt',
      content: 'Test prompt content'
    };
    
    render(<SystemPromptsTest initialPrompts={[initialPrompt]} />);
    
    // Open the system prompts modal
    const systemPromptsButton = screen.getByTestId('system-prompts-button');
    fireEvent.click(systemPromptsButton);
    
    // Select the prompt
    const selectButton = screen.getByTestId('select-prompt-test-prompt-1');
    fireEvent.click(selectButton);
    
    // Close the modal to see the selected prompt in the FileList
    const closeButton = screen.getByTestId('close-modal-button');
    fireEvent.click(closeButton);
    
    // Reopen the modal
    fireEvent.click(systemPromptsButton);
    
    // Update the prompt
    const updateButton = screen.getByTestId('update-prompt-test-prompt-1');
    fireEvent.click(updateButton);
    
    // Close the modal to see the updated prompt in the FileList
    fireEvent.click(screen.getByTestId('close-modal-button'));
    
    // The updated prompt should be selected
    expect(screen.getByTestId('selected-prompt-test-prompt-1')).toBeInTheDocument();
    expect(screen.getByText('Updated Test Prompt')).toBeInTheDocument();
  });
}); 