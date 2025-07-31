import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceListItem } from '../components/workspace-list-item';
import { renderWithProviders } from './test-helpers';

describe('WorkspaceListItem - Interaction Tests', () => {
  const defaultProps = {
    name: 'test-workspace',
    index: 0,
    isSelected: false,
    isRenaming: false,
    isDragging: false,
    isDragOver: false,
    shouldShowGap: false,
    newName: '',
    onToggleSelect: jest.fn(),
    onRenameStart: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
    onRenameChange: jest.fn(),
    onLoad: jest.fn(),
    onDelete: jest.fn(),
    dragHandlers: {
      onDragStart: jest.fn(),
      onDragEnter: jest.fn(),
      onDragOver: jest.fn(),
      onDrop: jest.fn(),
      onDragEnd: jest.fn(),
    },
    transform: 'translateY(0)',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Selection Behavior', () => {
    it('should toggle selection when checkbox is clicked', () => {
      // Given: An unselected workspace item
      const onToggleSelect = jest.fn();
      const { getByRole } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} onToggleSelect={onToggleSelect} />
      );

      // When: User clicks the checkbox
      const checkbox = getByRole('checkbox', { name: 'Select test-workspace' });
      fireEvent.click(checkbox);

      // Then: Selection toggle should be called
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
      expect(checkbox).not.toBeChecked();
    });

    it('should reflect selected state in checkbox', () => {
      // Given: A selected workspace item
      const { getByRole } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} isSelected={true} />
      );

      // Then: Checkbox should be checked
      const checkbox = getByRole('checkbox', { name: 'Select test-workspace' });
      expect(checkbox).toBeChecked();
    });

    it('should stop propagation when checkbox is clicked', () => {
      // Given: A workspace item with event handlers
      const parentClickHandler = jest.fn();
      const { getByRole } = renderWithProviders(
        <div onClick={parentClickHandler}>
          <WorkspaceListItem {...defaultProps} />
        </div>
      );

      // When: User clicks the checkbox
      const checkbox = getByRole('checkbox', { name: 'Select test-workspace' });
      fireEvent.click(checkbox);

      // Then: Click should not propagate to parent
      expect(parentClickHandler).not.toHaveBeenCalled();
      expect(defaultProps.onToggleSelect).toHaveBeenCalled();
    });
  });

  describe('Rename Functionality', () => {
    it('should enter rename mode when rename button is clicked', () => {
      // Given: A workspace in normal display mode
      const onRenameStart = jest.fn();
      const { getByTitle } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} onRenameStart={onRenameStart} />
      );

      // When: User clicks rename button
      const renameButton = getByTitle('Rename workspace');
      fireEvent.click(renameButton);

      // Then: Rename should be initiated
      expect(onRenameStart).toHaveBeenCalledTimes(1);
    });

    it('should display input field and focus it when in rename mode', () => {
      // Given: A workspace entering rename mode
      const { container } = renderWithProviders(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="test-workspace"
        />
      );

      // Then: Input should be displayed and focused
      const input = container.querySelector('.prompt-title-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('test-workspace');
      
      // Focus is set in useEffect, so we need to wait
      waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
    });

    it('should update name as user types', async () => {
      // Given: A workspace in rename mode
      const onRenameChange = jest.fn();
      const user = userEvent.setup();
      
      const { container } = renderWithProviders(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="old-name"
          onRenameChange={onRenameChange}
        />
      );

      // When: User types new name
      const input = container.querySelector('.prompt-title-input') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'new-workspace-name');

      // Then: Change handler should be called for each character
      expect(onRenameChange).toHaveBeenCalled();
      expect(onRenameChange).toHaveBeenLastCalledWith('new-workspace-name');
    });

    it('should confirm rename when Enter key is pressed', () => {
      // Given: A workspace in rename mode with a new name
      const onRenameConfirm = jest.fn();
      const { container } = renderWithProviders(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="new-name"
          onRenameConfirm={onRenameConfirm}
        />
      );

      // When: User presses Enter
      const input = container.querySelector('.prompt-title-input') as HTMLInputElement;
      fireEvent.keyDown(input, { key: 'Enter' });

      // Then: Rename should be confirmed
      expect(onRenameConfirm).toHaveBeenCalledWith('new-name');
    });

    it('should disable confirm button when name is empty or unchanged', () => {
      // Given: A workspace in rename mode with empty name
      const { getByTitle, rerender } = renderWithProviders(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName=""
        />
      );

      // Then: Confirm button should be disabled
      let confirmButton = getByTitle('Confirm rename') as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);

      // When: Name is same as original
      rerender(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="test-workspace"
        />
      );

      // Then: Confirm button should still be disabled
      confirmButton = getByTitle('Confirm rename') as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);

      // When: Name is different
      rerender(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="different-name"
        />
      );

      // Then: Confirm button should be enabled
      confirmButton = getByTitle('Confirm rename') as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(false);
    });

    it('should cancel rename when cancel button is clicked', () => {
      // Given: A workspace in rename mode
      const onRenameCancel = jest.fn();
      const { getByTitle } = renderWithProviders(
        <WorkspaceListItem 
          {...defaultProps} 
          isRenaming={true} 
          newName="partial-edit"
          onRenameCancel={onRenameCancel}
        />
      );

      // When: User clicks cancel button
      const cancelButton = getByTitle('Cancel rename');
      fireEvent.click(cancelButton);

      // Then: Rename should be cancelled
      expect(onRenameCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Action Buttons Behavior', () => {
    it('should load workspace when load button is clicked', () => {
      // Given: A workspace item
      const onLoad = jest.fn();
      const { getByTitle } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} onLoad={onLoad} />
      );

      // When: User clicks load button
      const loadButton = getByTitle('Load workspace');
      fireEvent.click(loadButton);

      // Then: Load handler should be called
      expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it('should delete workspace when delete button is clicked', () => {
      // Given: A workspace item
      const onDelete = jest.fn();
      const { getByTitle } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} onDelete={onDelete} />
      );

      // When: User clicks delete button
      const deleteButton = getByTitle('Delete workspace');
      fireEvent.click(deleteButton);

      // Then: Delete handler should be called
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Drag and Drop Behavior', () => {
    it('should be draggable when not in rename mode', () => {
      // Given: A workspace in normal mode
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} />
      );

      // Then: Item should be draggable
      const item = container.querySelector('.workspace-item');
      expect(item?.getAttribute('draggable')).toBe('true');
    });

    it('should not be draggable when in rename mode', () => {
      // Given: A workspace in rename mode
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} isRenaming={true} />
      );

      // Then: Item should not be draggable
      const item = container.querySelector('.workspace-item');
      expect(item?.getAttribute('draggable')).toBe('false');
    });

    it('should apply dragging class when being dragged', () => {
      // Given: A workspace being dragged
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} isDragging={true} />
      );

      // Then: Dragging class should be applied
      const item = container.querySelector('.workspace-item');
      expect(item?.classList.contains('dragging')).toBe(true);
    });

    it('should apply drag-over class when showing gap', () => {
      // Given: A workspace with drag-over state
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} shouldShowGap={true} />
      );

      // Then: Drag-over class should be applied
      const item = container.querySelector('.workspace-item');
      expect(item?.classList.contains('drag-over')).toBe(true);
    });

    it('should call drag handlers when drag events occur', () => {
      // Given: A workspace with drag handlers
      const dragHandlers = {
        onDragStart: jest.fn(),
        onDragEnter: jest.fn(),
        onDragOver: jest.fn(),
        onDrop: jest.fn(),
        onDragEnd: jest.fn(),
      };

      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} dragHandlers={dragHandlers} />
      );

      const item = container.querySelector('.workspace-item') as HTMLElement;

      // When: Various drag events occur
      fireEvent.dragStart(item);
      fireEvent.dragEnter(item);
      fireEvent.dragOver(item);
      fireEvent.drop(item);
      fireEvent.dragEnd(item);

      // Then: All handlers should be called
      expect(dragHandlers.onDragStart).toHaveBeenCalledTimes(1);
      expect(dragHandlers.onDragEnter).toHaveBeenCalledTimes(1);
      expect(dragHandlers.onDragOver).toHaveBeenCalledTimes(1);
      expect(dragHandlers.onDrop).toHaveBeenCalledTimes(1);
      expect(dragHandlers.onDragEnd).toHaveBeenCalledTimes(1);
    });

    it('should apply transform style based on transform prop', () => {
      // Given: A workspace with a transform
      const transform = 'translateY(-44px)';
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} transform={transform} />
      );

      // Then: Transform should be applied
      const item = container.querySelector('.workspace-item') as HTMLElement;
      expect(item.style.transform).toBe(transform);
      expect(item.style.transition).toContain('transform');
    });
  });

  describe('Visual Elements', () => {
    it('should display workspace name correctly', () => {
      // Given: A workspace with a specific name
      const { getByText } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} name="my-important-project" />
      );

      // Then: Name should be displayed
      expect(getByText('my-important-project')).toBeTruthy();
    });

    it('should show drag handle', () => {
      // Given: A workspace item
      const { container } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} />
      );

      // Then: Drag handle should be present
      const dragHandle = container.querySelector('.drag-handle');
      expect(dragHandle).toBeTruthy();
    });

    it('should hide action buttons when in rename mode', () => {
      // Given: A workspace in rename mode
      const { queryByTitle } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} isRenaming={true} />
      );

      // Then: Regular action buttons should not be visible
      expect(queryByTitle('Load workspace')).toBeNull();
      expect(queryByTitle('Rename workspace')).toBeNull();
      expect(queryByTitle('Delete workspace')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels for checkbox', () => {
      // Given: A workspace item
      const { getByLabelText } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} name="accessible-workspace" />
      );

      // Then: Checkbox should have proper label
      const checkbox = getByLabelText('Select accessible-workspace');
      expect(checkbox).toBeTruthy();
      expect(checkbox.getAttribute('type')).toBe('checkbox');
    });

    it('should have proper titles for all action buttons', () => {
      // Given: A workspace item
      const { getByTitle } = renderWithProviders(
        <WorkspaceListItem {...defaultProps} />
      );

      // Then: All buttons should have descriptive titles
      expect(getByTitle('Load workspace')).toBeTruthy();
      expect(getByTitle('Rename workspace')).toBeTruthy();
      expect(getByTitle('Delete workspace')).toBeTruthy();
    });
  });
});