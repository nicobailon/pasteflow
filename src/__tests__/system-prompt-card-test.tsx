import { render, fireEvent, screen } from '@testing-library/react';

import '@testing-library/jest-dom';
import { SystemPrompt } from '../types/file-types';

// Mock CopyButton component
jest.mock('../components/copy-button', () => {
  return {
    __esModule: true,
    default: ({ text, className, children }: any) => (
      <button className={className} data-testid="copy-button" data-copy-text={text}>
        {children}
      </button>
    )
  };
});

// Using shared lucide-react mock from jest.config.js

// Import after mocking dependencies
import SystemPromptCard from '../components/system-prompt-card';

describe('SystemPromptCard Component', () => {
  // Test data
  const mockPrompt: SystemPrompt = {
    id: 'test-prompt-1',
    name: 'Test Prompt Name',
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
    
    // Check if name is displayed
    expect(screen.getByText('Test Prompt Name')).toBeInTheDocument();
    
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
    const smallTokenCount = Number.parseInt(smallTokenText!.match(/\d+/)![0]);
    
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
    const largeTokenCount = Number.parseInt(largeTokenText!.replace(',', '').match(/\d+/)![0]);
    
    // Verify that larger content produces at least the same token count
    // without coupling to specific calculation formula
    expect(largeTokenCount).toBeGreaterThanOrEqual(smallTokenCount);
  });
  
  it('correctly handles long prompt names by using the monospace class', () => {
    const longNamePrompt: SystemPrompt = {
      ...mockPrompt,
      name: 'This is a very long prompt name that might need special handling in the UI'
    };
    
    render(
      <SystemPromptCard
        prompt={longNamePrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check if the name element has the monospace class
    const nameElement = screen.getByText(longNamePrompt.name);
    expect(nameElement).toHaveClass('monospace');
  });
  
  it('renders consistent UI with all expected elements', () => {
    const { container } = render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Behavioral assertions BEFORE snapshot
    expect(screen.getByText(mockPrompt.name)).toBeInTheDocument();
    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByTestId('copy-button')).toHaveAttribute('data-copy-text', mockPrompt.content);
    expect(screen.getByTitle('Remove from selection')).toBeInTheDocument();
    expect(screen.getByText(/~\d+,?\d* tokens/)).toBeInTheDocument();
    expect(screen.getByTestId('message-square-code-icon')).toBeInTheDocument();
    
    // Snapshot for visual regression detection
    expect(container).toMatchSnapshot();
  });

  it('supports keyboard navigation and focus management', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    // Test that buttons can receive focus
    removeButton.focus();
    expect(document.activeElement).toBe(removeButton);
    
    // Test that buttons are in the tab order (have no tabindex or tabindex=0)
    expect(removeButton).not.toHaveAttribute('tabindex', '-1');
    expect(copyButton).not.toHaveAttribute('tabindex', '-1');
    
    // Test button behavior - clicking after focus should work
    fireEvent.click(removeButton);
    expect(mockToggleSelection).toHaveBeenCalledWith(mockPrompt);
  });

  it('provides proper accessibility attributes', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    expect(removeButton).toHaveAttribute('title', 'Remove from selection');
    expect(copyButton).toHaveAttribute('data-copy-text', mockPrompt.content);
    expect(removeButton.tagName).toBe('BUTTON');
    expect(copyButton.tagName).toBe('BUTTON');
  });
});

describe('Accessibility Features', () => {
  const mockPrompt: SystemPrompt = {
    id: 'test-prompt-1',
    name: 'Test Prompt Name',
    content: 'This is a test system prompt content with enough text to test token counting.'
  };
  
  const mockToggleSelection = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should support keyboard navigation', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    // Test that buttons can be focused
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);            // 1. Copy button focusable
    
    removeButton.focus();
    expect(document.activeElement).toBe(removeButton);          // 2. Remove button focusable
    
    // Test keyboard activation via click (onClick handles Enter/Space)
    fireEvent.click(removeButton);
    expect(mockToggleSelection).toHaveBeenCalledWith(mockPrompt); // 3. Click handler works
    
    // Verify buttons are keyboard accessible
    expect(removeButton.tagName).toBe('BUTTON');                // 4. Semantic button
    expect(copyButton.tagName).toBe('BUTTON');                  // 5. Semantic button
  });
  
  it('should provide proper ARIA attributes', () => {
    const { container } = render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check for basic accessibility attributes
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    // Verify buttons have accessible names
    expect(removeButton).toHaveAttribute('title', 'Remove from selection'); // 1. Remove button labeled
    expect(copyButton).toHaveAttribute('data-copy-text', mockPrompt.content); // 2. Copy data present
    
    // Check structure
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('file-card');                      // 3. Card structure
    expect(card).toHaveClass('system-prompt-card');            // 4. Specific type identified
    
    // Verify no aria-hidden on interactive elements
    expect(removeButton).not.toHaveAttribute('aria-hidden');   // 5. Interactive elements visible
    expect(copyButton).not.toHaveAttribute('aria-hidden');     // 6. Interactive elements visible
  });
  
  it('should announce important information to screen readers', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check for token count visibility to screen readers
    const tokenText = screen.getByText(/~\d+,?\d* tokens/);
    expect(tokenText).not.toHaveAttribute('aria-hidden');       // 1. Token count announced
    expect(tokenText).toBeInTheDocument();                      // 2. Token text exists
    
    // Check for system prompt badge visibility
    const systemPromptBadge = screen.getByText('System Prompt');
    expect(systemPromptBadge).not.toHaveAttribute('aria-hidden'); // 3. Badge announced
    expect(systemPromptBadge).toBeInTheDocument();              // 4. Badge exists
    
    // Verify prompt name is visible
    const promptName = screen.getByText(mockPrompt.name);
    expect(promptName).toBeInTheDocument();                     // 5. Name visible
    expect(promptName).toHaveClass('file-card-name');          // 6. Proper styling
  });
  
  it('should maintain focus visibility', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    const removeButton = screen.getByTitle('Remove from selection');
    const copyButton = screen.getByTestId('copy-button');
    
    // Focus each button and check it's visible
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);            // 1. Copy button can focus
    expect(copyButton).toHaveClass('file-card-action');        // 2. Has action class
    
    removeButton.focus();
    expect(document.activeElement).toBe(removeButton);          // 3. Remove button can focus
    expect(removeButton).toHaveClass('remove-selection-btn');   // 4. Has specific class
    
    // Verify buttons are not hidden
    expect(removeButton).toBeVisible();                         // 5. Remove button visible
    expect(copyButton).toBeVisible();                           // 6. Copy button visible
  });
  
  it('should support keyboard-only interaction flow', () => {
    render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Simulate keyboard-only user flow
    const copyButton = screen.getByTestId('copy-button');
    const removeButton = screen.getByTitle('Remove from selection');
    
    // Focus buttons
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);            // 1. Can reach copy
    
    removeButton.focus();
    expect(document.activeElement).toBe(removeButton);          // 2. Can reach remove
    
    // Activate with click (simulates Enter/Space on button)
    fireEvent.click(removeButton);
    expect(mockToggleSelection).toHaveBeenCalledTimes(1);       // 3. Activation works
    expect(mockToggleSelection).toHaveBeenCalledWith(mockPrompt); // 4. Correct args
    
    // Verify both buttons are interactive
    expect(removeButton).not.toBeDisabled();                    // 5. Remove enabled
    expect(copyButton).not.toBeDisabled();                      // 6. Copy enabled
  });
  
  it('should handle high contrast mode appropriately', () => {
    const { container } = render(
      <SystemPromptCard
        prompt={mockPrompt}
        toggleSelection={mockToggleSelection}
      />
    );
    
    // Check that colors are not the only means of conveying information
    const systemPromptBadge = screen.getByText('System Prompt');
    expect(systemPromptBadge).toHaveTextContent('System Prompt'); // 1. Text label present
    
    // Icons should have text alternatives
    const removeButton = screen.getByTitle('Remove from selection');
    expect(removeButton).toHaveAttribute('title');              // 2. Title for icon button
    
    // Verify structure provides context
    expect(container.firstChild).toHaveClass('file-card');      // 3. Card class
    expect(container.firstChild).toHaveClass('system-prompt-card'); // 4. Type identified
    
    // Text elements should be distinguishable
    const tokenText = screen.getByText(/~\d+,?\d* tokens/);
    expect(tokenText).toHaveClass('file-card-tokens');         // 5. Token styling
    
    const nameText = screen.getByText(mockPrompt.name);
    expect(nameText).toHaveClass('monospace');                 // 6. Monospace font
  });
}); 