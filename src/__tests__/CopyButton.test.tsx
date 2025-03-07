import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CopyButton from '../components/CopyButton';

// Mock the clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

describe('CopyButton Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    render(<CopyButton text="Test content" />);
    const button = screen.getByRole('button');
    
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Copy to clipboard');
    // Check for Copy icon (not explicitly checking for the Lucide component)
    expect(button).not.toHaveTextContent('Copied!');
  });

  it('renders children when provided', () => {
    render(<CopyButton text="Test content">Copy Text</CopyButton>);
    
    expect(screen.getByText('Copy Text')).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    render(<CopyButton text="Test content" className="custom-class" />);
    
    const button = screen.getByRole('button');
    expect(button.className).toContain('custom-class');
  });

  it('copies text to clipboard when clicked', async () => {
    render(<CopyButton text="Test content to copy" />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test content to copy');
    expect(button).toHaveAttribute('title', 'Copied!');
    
    // Check for animation elements
    const rippleElement = screen.getByText('', { selector: '.animate-ping' });
    expect(rippleElement).toBeInTheDocument();
    
    // Wait for state to return to normal
    await waitFor(() => {
      expect(button).toHaveAttribute('title', 'Copy to clipboard');
    }, { timeout: 2100 });
  });

  it('handles clipboard API failure', async () => {
    // Mock a clipboard error
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error('Clipboard error'));
    
    // Spy on console.error
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<CopyButton text="Test content" />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    // Wait for the async operation
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy:', expect.any(Error));
    });
    
    consoleSpy.mockRestore();
  });

  it('changes visual state when copying', async () => {
    render(<CopyButton text="Test content" />);
    const button = screen.getByRole('button');
    
    // Initial state check
    expect(button.className).toContain('bg-blue-500');
    expect(button.className).not.toContain('bg-green-500');
    
    // Click to copy
    fireEvent.click(button);
    
    // After click check
    expect(button.className).toContain('bg-green-500');
    
    // Wait for reset (2 seconds)
    await waitFor(() => {
      expect(button.className).not.toContain('bg-green-500');
      expect(button.className).toContain('bg-blue-500');
    }, { timeout: 2100 });
  });
}); 