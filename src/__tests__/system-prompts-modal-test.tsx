import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { useUIStore, usePromptStore } from '../stores';
import type { SystemPrompt } from '../types/file-types';

jest.mock('@radix-ui/react-dialog', () => {
  const React = require('react');
  let dialogOnOpenChange: ((open: boolean) => void) | undefined;

  return {
    __esModule: true,
    Root: ({ open, onOpenChange, children }: { open: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) => {
      dialogOnOpenChange = onOpenChange;
      if (!open) return null;
      return <div data-testid="dialog-root">{children}</div>;
    },
    Portal: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-portal">{children}</div>,
    Overlay: () => <div data-testid="dialog-overlay" />,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="modal" aria-modal="true" className={className}>
        {children}
      </div>
    ),
    Title: ({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) => (
      <div data-testid="dialog-title">{asChild ? children : <h2>{children}</h2>}</div>
    ),
    Description: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-description">{children}</div>,
    Close: ({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) => {
      if (asChild) {
        return React.cloneElement(children as React.ReactElement, {
          onClick: (e: React.MouseEvent) => {
            const originalOnClick = (children as React.ReactElement).props?.onClick;
            if (originalOnClick) originalOnClick(e);
            if (dialogOnOpenChange) dialogOnOpenChange(false);
          }
        });
      }
      return (
        <button data-testid="dialog-close" onClick={() => dialogOnOpenChange && dialogOnOpenChange(false)}>
          {children}
        </button>
      );
    }
  };
});

import SystemPromptsModal from '../components/system-prompts-modal';

describe('SystemPromptsModal Component', () => {
  const mockSystemPrompts: SystemPrompt[] = [
    { id: '1', name: 'Test Prompt 1', content: 'This is a test system prompt content 1' },
    { id: '2', name: 'Test Prompt 2', content: 'This is a test system prompt content 2' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useUIStore.setState({ systemPromptsModalOpen: false, systemPromptToEdit: null });
    usePromptStore.setState({ systemPrompts: [], selectedSystemPrompts: [] });
  });

  it('renders correctly when open with system prompts', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts, selectedSystemPrompts: [mockSystemPrompts[0]] });

    render(<SystemPromptsModal />);

    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText('System Prompts')).toBeInTheDocument();
    expect(screen.getByText('Test Prompt 1')).toBeInTheDocument();
    expect(screen.getByText('Test Prompt 2')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    useUIStore.setState({ systemPromptsModalOpen: false });

    render(<SystemPromptsModal />);

    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('shows empty state when no prompts exist', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: [] });

    render(<SystemPromptsModal />);

    expect(screen.getByText(/No system prompts yet/i)).toBeInTheDocument();
  });

  it('displays the add new prompt form by default', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });

    render(<SystemPromptsModal />);

    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter prompt name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter prompt content')).toBeInTheDocument();
  });

  it('adds a new prompt when form is submitted', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });

    render(<SystemPromptsModal />);

    const nameInput = screen.getByPlaceholderText('Enter prompt name');
    const contentInput = screen.getByPlaceholderText('Enter prompt content');

    fireEvent.change(nameInput, { target: { value: 'New Prompt' } });
    fireEvent.change(contentInput, { target: { value: 'New content' } });

    const addButton = screen.getByRole('button', { name: /Add Prompt/i });
    fireEvent.click(addButton);

    const state = usePromptStore.getState();
    expect(state.systemPrompts).toHaveLength(1);
    expect(state.systemPrompts[0].name).toBe('New Prompt');
    expect(state.systemPrompts[0].content).toBe('New content');
  });

  it('deletes a prompt when delete button is clicked', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    render(<SystemPromptsModal />);

    const deleteButtons = screen.getAllByTitle('Delete this prompt');
    fireEvent.click(deleteButtons[0]);

    const state = usePromptStore.getState();
    expect(state.systemPrompts).toHaveLength(1);
    expect(state.systemPrompts[0].id).toBe('2');
  });

  it('toggles prompt selection', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts, selectedSystemPrompts: [] });

    render(<SystemPromptsModal />);

    const toggleButtons = screen.getAllByTitle('Add to selection');
    fireEvent.click(toggleButtons[0]);

    const state = usePromptStore.getState();
    expect(state.selectedSystemPrompts).toHaveLength(1);
    expect(state.selectedSystemPrompts[0].id).toBe('1');
  });

  it('shows edit form when clicking a prompt', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    render(<SystemPromptsModal />);

    const promptItem = screen.getByText('Test Prompt 1').closest('[role="button"]');
    fireEvent.click(promptItem!);

    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Prompt 1')).toBeInTheDocument();
  });

  it('updates a prompt when edit form is submitted', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    render(<SystemPromptsModal />);

    const promptItem = screen.getByText('Test Prompt 1').closest('[role="button"]');
    fireEvent.click(promptItem!);

    const nameInput = screen.getByDisplayValue('Test Prompt 1');
    fireEvent.change(nameInput, { target: { value: 'Updated Prompt' } });

    const updateButton = screen.getByRole('button', { name: /Update Prompt/i });
    fireEvent.click(updateButton);

    const state = usePromptStore.getState();
    expect(state.systemPrompts[0].name).toBe('Updated Prompt');
  });

  it('cancels edit when cancel button is clicked', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    render(<SystemPromptsModal />);

    const promptItem = screen.getByText('Test Prompt 1').closest('[role="button"]');
    fireEvent.click(promptItem!);

    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(screen.getByText('Add New System Prompt')).toBeInTheDocument();
  });

  it('sets initial edit prompt when provided', () => {
    useUIStore.setState({ systemPromptsModalOpen: true, systemPromptToEdit: mockSystemPrompts[1] });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    render(<SystemPromptsModal />);

    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Prompt 2')).toBeInTheDocument();
  });

  it('clears local state when modal closes and reopens', () => {
    useUIStore.setState({ systemPromptsModalOpen: true });
    usePromptStore.setState({ systemPrompts: mockSystemPrompts });

    const { rerender } = render(<SystemPromptsModal />);

    const nameInput = screen.getByPlaceholderText('Enter prompt name');
    fireEvent.change(nameInput, { target: { value: 'Partial input' } });

    expect(screen.getByDisplayValue('Partial input')).toBeInTheDocument();

    useUIStore.setState({ systemPromptsModalOpen: false });
    rerender(<SystemPromptsModal />);

    useUIStore.setState({ systemPromptsModalOpen: true });
    rerender(<SystemPromptsModal />);

    expect(screen.queryByDisplayValue('Partial input')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter prompt name')).toHaveValue('');
  });
});
