import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DropdownMenuItem } from '../components/dropdown-menu-item';
import { DropdownOption } from '../components/dropdown';

describe('DropdownMenuItem', () => {
  const mockOnSelect = jest.fn();
  const mockOnKeyDown = jest.fn();
  const mockGetItemClassName = jest.fn();
  const mockRenderMenuItem = jest.fn();
  const mockRenderCustomOption = jest.fn();

  const defaultOption: DropdownOption = {
    value: 'test-value',
    label: 'Test Label',
    icon: <span>📁</span>
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemClassName.mockReturnValue('test-class');
    mockRenderMenuItem.mockReturnValue(<span>Rendered Item</span>);
  });

  describe('rendering behavior', () => {
    it('should render menu item with correct role and tabIndex', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      expect(menuItem).toBeInTheDocument();
      expect(menuItem).toHaveAttribute('tabIndex', '0');
    });

    it('should apply className from getItemClassName when no custom renderer', () => {
      mockGetItemClassName.mockReturnValue('active-item');
      
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={true}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      expect(menuItem).toHaveClass('active-item');
      expect(mockGetItemClassName).toHaveBeenCalledWith(true);
    });

    it('should not apply className when renderCustomOption is provided', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          renderCustomOption={mockRenderCustomOption}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      expect(menuItem).not.toHaveClass('test-class');
      expect(menuItem.className).toBe('');
    });

    it('should render content from renderMenuItem function', () => {
      mockRenderMenuItem.mockReturnValue(<span data-testid="custom-content">Custom Content</span>);
      
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      expect(screen.getByTestId('custom-content')).toBeInTheDocument();
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
      expect(mockRenderMenuItem).toHaveBeenCalledWith(defaultOption, false);
    });

    it('should pass isActive state to renderMenuItem', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={true}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      expect(mockRenderMenuItem).toHaveBeenCalledWith(defaultOption, true);
      expect(mockRenderMenuItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('interaction handling', () => {
    it('should call onSelect with option value when clicked', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      fireEvent.click(menuItem);
      
      expect(mockOnSelect).toHaveBeenCalledWith('test-value');
      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });

    it('should call onKeyDown with event and value when key is pressed', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
      fireEvent.keyDown(menuItem, enterEvent);
      
      expect(mockOnKeyDown).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'Enter' }),
        'test-value'
      );
      expect(mockOnKeyDown).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple clicks correctly', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      fireEvent.click(menuItem);
      fireEvent.click(menuItem);
      fireEvent.click(menuItem);
      
      expect(mockOnSelect).toHaveBeenCalledTimes(3);
      expect(mockOnSelect).toHaveBeenCalledWith('test-value');
    });

    it('should handle different keyboard events', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      
      fireEvent.keyDown(menuItem, { key: 'Enter' });
      fireEvent.keyDown(menuItem, { key: 'Space' });
      fireEvent.keyDown(menuItem, { key: 'Escape' });
      
      expect(mockOnKeyDown).toHaveBeenCalledTimes(3);
      expect(mockOnKeyDown).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: 'Enter' }), 'test-value');
      expect(mockOnKeyDown).toHaveBeenNthCalledWith(2, expect.objectContaining({ key: 'Space' }), 'test-value');
      expect(mockOnKeyDown).toHaveBeenNthCalledWith(3, expect.objectContaining({ key: 'Escape' }), 'test-value');
    });
  });

  describe('different option types', () => {
    it('should handle options with different value types', () => {
      const numericOption: DropdownOption = {
        value: '123',
        label: 'Numeric',
      };
      
      render(
        <DropdownMenuItem
          option={numericOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      fireEvent.click(screen.getByRole('menuitem'));
      
      expect(mockOnSelect).toHaveBeenCalledWith('123');
      expect(mockRenderMenuItem).toHaveBeenCalledWith(numericOption, false);
    });

    it('should handle options without icons', () => {
      const noIconOption: DropdownOption = {
        value: 'no-icon',
        label: 'No Icon Option'
      };
      
      render(
        <DropdownMenuItem
          option={noIconOption}
          isActive={true}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      expect(screen.getByRole('menuitem')).toBeInTheDocument();
      expect(mockRenderMenuItem).toHaveBeenCalledWith(noIconOption, true);
    });

    it('should handle options with complex icons', () => {
      const complexIconOption: DropdownOption = {
        value: 'complex',
        label: 'Complex',
        icon: <svg data-testid="complex-icon"><path d="M0 0" /></svg>
      };
      
      mockRenderMenuItem.mockReturnValue(
        <div>
          {complexIconOption.icon}
          <span>{complexIconOption.label}</span>
        </div>
      );
      
      render(
        <DropdownMenuItem
          option={complexIconOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      expect(screen.getByTestId('complex-icon')).toBeInTheDocument();
      expect(screen.getByText('Complex')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should be keyboard navigable', () => {
      render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      menuItem.focus();
      
      expect(document.activeElement).toBe(menuItem);
      expect(menuItem).toHaveFocus();
    });

    it('should maintain focus state correctly', () => {
      const { rerender } = render(
        <DropdownMenuItem
          option={defaultOption}
          isActive={false}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      const menuItem = screen.getByRole('menuitem');
      menuItem.focus();
      
      rerender(
        <DropdownMenuItem
          option={defaultOption}
          isActive={true}
          onSelect={mockOnSelect}
          onKeyDown={mockOnKeyDown}
          getItemClassName={mockGetItemClassName}
          renderMenuItem={mockRenderMenuItem}
        />
      );
      
      expect(menuItem).toHaveFocus();
      expect(menuItem).toHaveAttribute('tabIndex', '0');
    });
  });
});