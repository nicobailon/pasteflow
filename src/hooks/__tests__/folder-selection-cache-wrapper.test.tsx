import { renderHook, act } from '@testing-library/react';

import useFileSelectionState from '../use-file-selection-state';

describe('folderSelectionCache wrapper behavior', () => {
  it('inherits optimistic state from ancestors and clears on toggle off', () => {
    // Provide an empty folder index to force an early noop plan
    // so we exercise the optimistic-only path without relying on streaming
    const emptyFolderIndex = new Map<string, string[]>();

    const { result } = renderHook(() =>
      useFileSelectionState([], '/root', emptyFolderIndex)
    );

    const parent = '/root/examples';
    const child = '/root/examples/rspec_to_minitest';
    const sibling = '/root/docs';

    // Optimistically mark parent as selected
    act(() => {
      result.current.toggleFolderSelection(parent, true, { optimistic: true });
    });

    // 1) Direct parent reflects optimistic state
    expect(result.current.folderSelectionCache?.get(parent)).toBe('full');
    // 2) Descendant inherits optimistic state from ancestor
    expect(result.current.folderSelectionCache?.get(child)).toBe('full');
    // 3) Unrelated sibling remains unaffected
    expect(result.current.folderSelectionCache?.get(sibling)).toBe('none');

    // Toggle parent off optimistically
    act(() => {
      result.current.toggleFolderSelection(parent, false, { optimistic: true });
    });

    // 4) Parent and descendant clear to none
    expect(result.current.folderSelectionCache?.get(parent)).toBe('none');
    expect(result.current.folderSelectionCache?.get(child)).toBe('none');
  });
});

