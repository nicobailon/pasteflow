import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterModal from '../components/FilterModal';

describe('FilterModal Component', () => {
  const mockExclusionPatterns = ['**/node_modules/**', '**/.git/**', '*.log'];
  const mockOnSave = jest.fn();
  const mockOnClose = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders correctly with provided exclusion patterns', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    // Check for header text
    expect(screen.getByText('File Exclusion Filters')).toBeInTheDocument();
    
    // Check for description
    expect(screen.getByText(/Files matching these patterns will be excluded/)).toBeInTheDocument();
    
    // Check textarea contains patterns
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    
    // Verify all patterns are included in the textarea
    mockExclusionPatterns.forEach(pattern => {
      expect(textarea).toHaveValue(expect.stringContaining(pattern));
    });
    
    // Check for buttons
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save Filters')).toBeInTheDocument();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('calls onClose when X button is clicked', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const closeButton = screen.getByText('×');
    fireEvent.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('calls onSave with filtered patterns when save button is clicked', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const saveButton = screen.getByText('Save Filters');
    fireEvent.click(saveButton);
    
    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnSave).toHaveBeenCalledWith(mockExclusionPatterns);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('allows editing patterns and saves the edited patterns', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const textarea = screen.getByRole('textbox');
    
    // Change textarea content to a custom pattern list
    const newContent = [
      '# Enter patterns to exclude, one per line',
      '# Use glob patterns like: **/node_modules/, **/*.tmp',
      '# Lines starting with # are comments',
      '',
      '**/dist/**',
      '**/*.tmp'
    ].join('\n');
    
    fireEvent.change(textarea, { target: { value: newContent } });
    
    const saveButton = screen.getByText('Save Filters');
    fireEvent.click(saveButton);
    
    // Should have filtered out comments and empty lines
    expect(mockOnSave).toHaveBeenCalledWith(['**/dist/**', '**/*.tmp']);
  });

  it('shows validation errors for invalid patterns', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const textarea = screen.getByRole('textbox');
    
    // Add invalid patterns with unbalanced brackets and braces
    const invalidContent = [
      '# Enter patterns to exclude, one per line',
      '# Use glob patterns like: **/node_modules/, **/*.tmp',
      '# Lines starting with # are comments',
      '',
      '**/[unclosed/bracket/**',
      '**/{unclosed/brace/**'
    ].join('\n');
    
    fireEvent.change(textarea, { target: { value: invalidContent } });
    
    const saveButton = screen.getByText('Save Filters');
    fireEvent.click(saveButton);
    
    // Should display validation errors
    expect(screen.getByText('Invalid patterns detected:')).toBeInTheDocument();
    expect(screen.getByText(/Unbalanced brackets/)).toBeInTheDocument();
    expect(screen.getByText(/Unbalanced braces/)).toBeInTheDocument();
    
    // Should not save when there are validation errors
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('validates patterns with invalid escape characters', () => {
    render(
      <FilterModal 
        exclusionPatterns={mockExclusionPatterns} 
        onSave={mockOnSave} 
        onClose={mockOnClose} 
      />
    );
    
    const textarea = screen.getByRole('textbox');
    
    // Add pattern with invalid escape character
    const invalidContent = [
      '# Enter patterns to exclude, one per line',
      '# Use glob patterns like: **/node_modules/, **/*.tmp',
      '# Lines starting with # are comments',
      '',
      'C:\\Windows\\System32'  // Single backslash is invalid
    ].join('\n');
    
    fireEvent.change(textarea, { target: { value: invalidContent } });
    
    const saveButton = screen.getByText('Save Filters');
    fireEvent.click(saveButton);
    
    // Should display validation error about escape characters
    expect(screen.getByText(/Invalid escape character/)).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });
}); 