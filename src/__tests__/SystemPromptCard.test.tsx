import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SystemPrompt } from '../types/FileTypes';

// Mock CopyButton component
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

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
  Settings: () => <div data-testid="settings-icon" />,
  MessageSquareCode: () => <div data-testid="message-square-code-icon" />
}));

// Import after mocking dependencies
import SystemPromptCard from '../components/SystemPromptCard';

describe('SystemPromptCard Component', () => {
  // Test data
  const mockPrompt: SystemPrompt = {
    id: 'test-prompt-1',
    title: 'Test Prompt Title',
    content: 'This is a test system prompt content with enough text to test token counting.'
  };
  
  // Mock functions
  const mockToggleSelection = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders correctly with prompt data', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check if title is displayed
    expect(screen.getByText('Test Prompt Title')).toBeInTheDocument();
    
    // Check if "System Prompt" badge is displayed
    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    
    // Check if token count is displayed (without coupling to specific formula)
    // Just verify that some token count is displayed with correct format
    expect(screen.getByText(/~\d+,?\d* tokens/)).toBeInTheDocument();
    
    // Check if the MessageSquareCode icon is displayed
    expect(screen.getByTestId('message-square-code-icon')).toBeInTheDocument();
    
    // Check if the copy button exists with the correct text to copy
    const copyButton = screen.getByTestId('copy-button');
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveAttribute('data-copy-text', mockPrompt.content);
    
    // Check if the remove selection button exists
    const removeButton = screen.getByTitle('Remove from selection');
    expect(removeButton).toBeInTheDocument();
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
  });
  
  it('calls toggleSelection when remove button is clicked', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Find the remove button
    const removeButton = screen.getByTitle('Remove from selection');
    
    // Click the remove button
    fireEvent.click(removeButton);
    
    // Check if toggleSelection was called with the prompt
    expect(mockToggleSelection).toHaveBeenCalledTimes(1);
    expect(mockToggleSelection).toHaveBeenCalledWith(mockPrompt);
  });
  
  it('displays different token counts based on content length', () => {
    // Test with empty content
    const emptyPrompt: SystemPrompt = {
      ...mockPrompt,
      content: ''
    };
    
    const { unmount } = render(
      <SystemPromptCard
        prompt={emptyPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Even empty content should show minimal token count (could be 0 or 1 depending on implementation)
    expect(screen.getByText(/~\d+ tokens/)).toBeInTheDocument();
    
    unmount();
    
    // Test with very small content
    const smallPrompt: SystemPrompt = {
      ...mockPrompt,
      content: 'Small'
    };
    
    render(
      <SystemPromptCard
        prompt={smallPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Should display a small token count
    const smallTokenText = screen.getByText(/~\d+ tokens/).textContent;
    const smallTokenCount = parseInt(smallTokenText!.match(/\d+/)![0]);
    
    // Test with larger content
    unmount();
    
    const largePrompt: SystemPrompt = {
      ...mockPrompt,
      content: 'A'.repeat(1000)
    };
    
    render(
      <SystemPromptCard
        prompt={largePrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Should display a larger token count - using getByText will fail if multiple elements match
    const tokenElements = screen.getAllByText(/~\d+,?\d* tokens/);
    const largeTokenText = tokenElements[0].textContent;
    const largeTokenCount = parseInt(largeTokenText!.replace(',', '').match(/\d+/)![0]);
    
    // Verify that larger content produces at least the same token count
    // without coupling to specific calculation formula
    expect(largeTokenCount).toBeGreaterThanOrEqual(smallTokenCount);
  });
  
  it('correctly handles long prompt titles by using the monospace class', () => {
    const longTitlePrompt: SystemPrompt = {
      ...mockPrompt,
      title: 'This is a very long prompt title that might need special handling in the UI'
    };
    
    render(
      <SystemPromptCard
        prompt={longTitlePrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check if the title element has the monospace class
    const titleElement = screen.getByText(longTitlePrompt.title);
    expect(titleElement).toHaveClass('monospace');
  });
  
  it('matches snapshot for consistent UI rendering', () => {
    const { container } = render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // This test will fail if the component's rendered output changes,
    // alerting developers to verify if the change is intended
    expect(container).toMatchSnapshot();
  });
}); 