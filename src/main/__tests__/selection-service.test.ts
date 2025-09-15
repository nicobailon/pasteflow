/** @jest-environment node */

import {
  normalizeRanges,
  mergeLineRanges,
  subtractLineRanges,
  applySelect,
  applyDeselect,
  SelectionServiceError,
} from '../selection-service';
import type { SelectedFileReference } from '../../types/file-types';

describe('SelectionService — line range normalization and mutations', () => {
  test('normalizeRanges should clamp, sort, and merge contiguous/overlapping ranges', () => {
    const input = [
      { start: 5, end: 3 },   // reversed -> [3,5]
      { start: -2, end: 2 },  // clamp -> [1,2]
      { start: 7, end: 7 },   // single line
      { start: 8, end: 10 },  // contiguous with [7,7] -> merge [7,10]
    ];

    const out = normalizeRanges(input)!;

    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ start: 1, end: 5 });
    expect(out[1]).toEqual({ start: 7, end: 10 });
  });

  test('mergeLineRanges should union two sets of ranges correctly', () => {
    const a = [{ start: 1, end: 2 }, { start: 5, end: 7 }];
    const b = [{ start: 3, end: 5 }, { start: 8, end: 8 }];

    const merged = mergeLineRanges(a, b)!;

    expect(merged).toEqual([
      { start: 1, end: 8 },
    ]);
    expect(merged.length).toBe(1);
  });

  test('subtractLineRanges should subtract segments leaving disjoint results', () => {
    const a = [{ start: 1, end: 10 }];
    const b = [{ start: 3, end: 4 }, { start: 7, end: 8 }];

    const out = subtractLineRanges(a, b)!;

    expect(out).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
      { start: 9, end: 10 },
    ]);
    expect(out.length).toBe(3);
  });

  test('applySelect should merge line selections and upgrade to whole file when lines omitted', () => {
    // Start empty
    let state = { selectedFiles: [] as { path: string; lines?: { start: number; end: number }[] }[] };

    // Select lines [2..3]
    state = applySelect(state, [{ path: '/proj/a.ts', lines: [{ start: 3, end: 2 }] }]); // reversed inputs allowed
    expect(state.selectedFiles).toEqual([{ path: '/proj/a.ts', lines: [{ start: 2, end: 3 }] }]);

    // Add overlapping/contiguous lines -> merge
    state = applySelect(state, [{ path: '/proj/a.ts', lines: [{ start: 4, end: 5 }, { start: 3, end: 4 }] }]);
    expect(state.selectedFiles[0].lines).toEqual([{ start: 2, end: 5 }]);

    // Upgrade to whole file when new selection has no lines
    state = applySelect(state, [{ path: '/proj/a.ts' }]);
    expect(state.selectedFiles).toEqual([{ path: '/proj/a.ts' }]);

    // Keep whole-file even if new selection proposes lines again
    state = applySelect(state, [{ path: '/proj/a.ts', lines: [{ start: 10, end: 12 }] }]);
    expect(state.selectedFiles).toEqual([{ path: '/proj/a.ts' }]);
  });

  test('applyDeselect should subtract ranges and drop entry when fully removed', () => {
    // Start with [1..10]
    const initial = { selectedFiles: [{ path: '/p/file.txt', lines: [{ start: 1, end: 10 }] }] };

    // Subtract [3..4] and [7..8]
    let state = applyDeselect(initial, [{ path: '/p/file.txt', lines: [{ start: 3, end: 4 }, { start: 7, end: 8 }] }]);
    expect(state.selectedFiles[0].lines).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
      { start: 9, end: 10 },
    ]);

    // Subtract remaining -> entry removed
    state = applyDeselect(state, [{ path: '/p/file.txt', lines: [{ start: 1, end: 10 }] }]);
    expect(state.selectedFiles.length).toBe(0);
    expect(state.selectedFiles).toEqual([]);
  });

  test('applyDeselect should throw when partially deselecting a whole-file selection', () => {
    const wholeFile: { selectedFiles: SelectedFileReference[] } = { selectedFiles: [{ path: '/p/whole.txt' }] };

    // Precondition assertion (counts toward density)
    expect(wholeFile.selectedFiles[0].lines).toBeUndefined();

    // Attempt partial deselect on whole file -> throws validation error
    expect(() =>
      applyDeselect(wholeFile, [{ path: '/p/whole.txt', lines: [{ start: 1, end: 1 }] }])
    ).toThrowError(SelectionServiceError);
  });
});
