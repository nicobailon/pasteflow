import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '../context/theme-context';
import WorkspaceModal from '../components/workspace-modal';
import { STORAGE_KEYS } from '../constants';
import { setupMockLocalStorage, mockDateNow } from './test-helpers';
import type { AppState } from '../hooks/use-app-state';

// Mock useWorkspaceState
jest.mock('../hooks/use-workspace-state', () => ({
  useWorkspaceState: () => ({
    saveWorkspace: jest.fn().mockImplementation((name, data) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces[name] = JSON.stringify({ ...data, savedAt: Date.now() });
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
      return true;
    }),
    loadWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      if (!workspaces[name]) return null;
      return JSON.parse(workspaces[name]);
    }),
    deleteWorkspace: jest.fn().mockImplementation((name) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      delete workspaces[name];
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      return true;
    }),
    renameWorkspace: jest.fn().mockImplementation((oldName, newName) => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      if (workspaces[newName]) return false;
      workspaces[newName] = workspaces[oldName];
      delete workspaces[oldName];
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      return true;
    }),
    getWorkspaceNames: jest.fn().mockImplementation(() => {
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      return Object.keys(workspaces);
    })
  })
}));

// Create a minimal mock that satisfies the AppState type requirements
const createMockAppState = (): Partial<AppState> => ({
  selectedFolder: '/test/folder',
  fileSelection: {
    selectedFiles: [{ path: 'test.ts', content: 'test content' }]
  } as AppState['fileSelection'],
  expandedNodes: { 'src': true },
  userInstructions: 'test instructions',
  currentWorkspace: localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE),
  loadWorkspace: jest.fn().mockImplementation((name: string) => {
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
    window.dispatchEvent(new CustomEvent('workspacesChanged'));
  }),
  saveWorkspace: jest.fn().mockImplementation((name: string) => {
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    workspaces[name] = JSON.stringify({ name, savedAt: Date.now() });
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, name);
    window.dispatchEvent(new CustomEvent('workspacesChanged'));
  })
});

const mockAppState = createMockAppState();

jest.mock('../hooks/use-app-state', () => () => mockAppState);

describe('WorkspaceModal Component', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    window.dispatchEvent = jest.fn();
    window.CustomEvent = jest.fn().mockImplementation((type, options) => ({
      type,
      detail: options?.detail
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should render workspace list in chronological order', () => {
    // Setup - create workspaces with different timestamps
    const now = Date.now();
    const workspaces = {
      'oldest': JSON.stringify({ name: 'oldest', savedAt: now - 3000 }),
      'middle': JSON.stringify({ name: 'middle', savedAt: now - 2000 }),
      'newest': JSON.stringify({ name: 'newest', savedAt: now - 1000 }),
    };
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Get workspace list items
    const workspaceItems = screen.getAllByRole('button', { name: /load/i });
    
    // Verify order (newest first)
    expect(workspaceItems[0]).toHaveTextContent('newest');
    expect(workspaceItems[1]).toHaveTextContent('middle');
    expect(workspaceItems[2]).toHaveTextContent('oldest');
  });

  test('should save workspace with correct data', async () => {
    // Setup
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Enter workspace name
    const nameInput = screen.getByLabelText(/workspace name/i);
    fireEvent.change(nameInput, { target: { value: 'new-test-workspace' } });
    
    // Click save button
    const saveButton = screen.getByRole('button', { name: /save workspace/i });
    fireEvent.click(saveButton);
    
    // Wait for the save operation to complete
    await waitFor(() => {
      expect(nameInput).toHaveValue('');
    });
    
    // Verify workspace was saved
    const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(workspaces['new-test-workspace']).toBeDefined();
  });

  test('should handle rename operation', async () => {
    // Setup - create an existing workspace
    const workspaces = {
      'old-name': JSON.stringify({ name: 'old-name', savedAt: Date.now() }),
    };
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'old-name');
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Get rename button and click it
    const renameButtons = screen.getAllByRole('button', { name: /rename/i });
    fireEvent.click(renameButtons[0]);
    
    // Enter new name in the rename input
    const renameInput = screen.getByTestId('rename-input');
    fireEvent.change(renameInput, { target: { value: 'new-name' } });
    
    // Submit the rename form
    const confirmRenameButton = screen.getByTestId('confirm-rename-button');
    fireEvent.click(confirmRenameButton);
    
    // Wait for the rename operation to complete
    await waitFor(() => {
      const updatedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(updatedWorkspaces['new-name']).toBeDefined();
    });
    
    // Verify workspace was renamed
    const updatedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(updatedWorkspaces['old-name']).toBeUndefined();
    expect(updatedWorkspaces['new-name']).toBeDefined();
  });

  test('should show save button animation states', async () => {
    // Setup - slow down the save operation for test visibility
    const mockSaveWorkspace = jest.fn().mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(true);
        }, 100);
      });
    });
    
    // Override the saveWorkspace implementation
    const { useWorkspaceState } = require('../hooks/use-workspace-state');
    useWorkspaceState.mockImplementation(() => ({
      ...jest.requireActual('../hooks/use-workspace-state').useWorkspaceState(),
      saveWorkspace: mockSaveWorkspace,
      getWorkspaceNames: jest.fn().mockReturnValue([])
    }));
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Enter workspace name
    const nameInput = screen.getByLabelText(/workspace name/i);
    fireEvent.change(nameInput, { target: { value: 'animation-test' } });
    
    // Click save button
    const saveButton = screen.getByRole('button', { name: /save workspace/i });
    fireEvent.click(saveButton);
    
    // Verify button shows spinner
    expect(saveButton).toHaveAttribute('data-state', 'saving');
    
    // Wait for success state
    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-state', 'success');
    });
    
    // Wait for return to idle state
    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-state', 'idle');
    }, { timeout: 2000 });
  });

  test('should prevent duplicate workspace names', async () => {
    // Setup - create an existing workspace
    const workspaces = {
      'existing-name': JSON.stringify({ name: 'existing-name', savedAt: Date.now() }),
    };
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Enter existing workspace name
    const nameInput = screen.getByLabelText(/workspace name/i);
    fireEvent.change(nameInput, { target: { value: 'existing-name' } });
    
    // Click save button
    const saveButton = screen.getByRole('button', { name: /save workspace/i });
    fireEvent.click(saveButton);
    
    // Verify error is shown
    await waitFor(() => {
      const errorMessage = screen.getByText(/workspace name already exists/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  test('should delete a workspace', async () => {
    // Setup - create workspaces
    const workspaces = {
      'workspace1': JSON.stringify({ name: 'workspace1', savedAt: Date.now() }),
      'workspace2': JSON.stringify({ name: 'workspace2', savedAt: Date.now() })
    };
    localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Click delete button for workspace1
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    
    // Confirm delete in confirmation dialog
    const confirmDeleteButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmDeleteButton);
    
    // Wait for the delete operation to complete
    await waitFor(() => {
      const updatedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(updatedWorkspaces)).toHaveLength(1);
    });
    
    // Verify workspace was deleted
    const updatedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
    expect(updatedWorkspaces['workspace1']).toBeUndefined();
    expect(updatedWorkspaces['workspace2']).toBeDefined();
  });
  
  // Adding new error case test
  test('should handle save error gracefully', async () => {
    // Setup - mock a failing save
    const mockFailingSave = jest.fn().mockImplementation(() => {
      return Promise.reject(new Error('Storage quota exceeded'));
    });
    
    // Override the saveWorkspace implementation
    const { useWorkspaceState } = require('../hooks/use-workspace-state');
    useWorkspaceState.mockImplementation(() => ({
      ...jest.requireActual('../hooks/use-workspace-state').useWorkspaceState(),
      saveWorkspace: mockFailingSave,
      getWorkspaceNames: jest.fn().mockReturnValue([])
    }));
    
    // Render modal
    render(<WorkspaceModal isOpen={true} onClose={() => {}} appState={mockAppState as AppState} />);
    
    // Enter workspace name
    const nameInput = screen.getByLabelText(/workspace name/i);
    fireEvent.change(nameInput, { target: { value: 'fail-test' } });
    
    // Click save button
    const saveButton = screen.getByRole('button', { name: /save workspace/i });
    fireEvent.click(saveButton);
    
    // Wait for error state
    await waitFor(() => {
      expect(saveButton).toHaveAttribute('data-state', 'error');
    });
    
    // Should show error message
    await waitFor(() => {
      const errorMessage = screen.getByText(/failed to save workspace/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });
}); 