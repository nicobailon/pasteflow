/**
 * Selection management utilities for Phase 3 (pure, no fs or DB).
 * - Normalizes/merges/subtracts line ranges
 * - Applies selection and deselection mutations over a Workspace-like state
 *
 * IMPORTANT PERSISTENCE DISCIPLINE:
 * - Persist only { path, lines? } per entry
 * - Do NOT persist content/tokenCount, even if DB types allow them
 */

import type { LineRange, SelectedFileReference } from '../types/file-types';

/** Items accepted by the selection API routes */
export interface SelectionItem {
  path: string;
  lines?: LineRange[];
}

/** Error codes for selection mutations */
export type SelectionServiceErrorCode =
  | 'PARTIAL_DESELECT_OF_WHOLE_FILE_NOT_SUPPORTED'
  | 'INVALID_LINE_RANGE_INPUT';

/** Domain error for selection service */
export class SelectionServiceError extends Error {
  constructor(public readonly code: SelectionServiceErrorCode, message: string) {
    super(message);
    this.name = 'SelectionServiceError';
  }
}

/**
 * Normalize a single range:
 * - Coerce integers
 * - Swap start/end if out of order
 * - Clamp to minimum 1 (upper bound unknown here, validated later during content formatting)
 */
function normalizeRange(r: LineRange): LineRange {
  let s = Number.isFinite(r.start) ? Math.trunc(r.start) : Number.NaN;
  let e = Number.isFinite(r.end) ? Math.trunc(r.end) : Number.NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    throw new SelectionServiceError('INVALID_LINE_RANGE_INPUT', 'Line range must be integers');
  }
  if (s < 1) s = 1;
  if (e < 1) e = 1;
  if (s > e) [s, e] = [e, s];
  return { start: s, end: e };
}

/**
 * Merge overlapping/contiguous ranges. Input must be normalized.
 * Contiguous: [1,5] and [6,10] merge into [1,10]
 */
function mergeNormalizedRanges(sorted: LineRange[]): LineRange[] {
  if (sorted.length === 0) return [];
  const result: LineRange[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= current.end + 1) {
      // Overlap or contiguous
      if (next.end > current.end) current.end = next.end;
    } else {
      result.push(current);
      current = { ...next };
    }
  }
  result.push(current);
  return result;
}

/**
 * Normalize and coalesce a set of ranges:
 * - Coerce/Clamp
 * - Sort by start
 * - Merge overlaps and contiguous segments
 */
export function normalizeRanges(ranges: LineRange[] | undefined): LineRange[] | undefined {
  if (!ranges || ranges.length === 0) return undefined;
  const normalized = ranges.map(normalizeRange).sort((a, b) => a.start - b.start);
  const merged = mergeNormalizedRanges(normalized);
  return merged.length > 0 ? merged : undefined;
}

/**
 * Merge two range sets (union). Both inputs can be undefined (meaning "whole file" if upstream decides).
 */
export function mergeLineRanges(a?: LineRange[], b?: LineRange[]): LineRange[] | undefined {
  const na = normalizeRanges(a);
  const nb = normalizeRanges(b);
  if (!na && !nb) return undefined;
  if (!na) return nb;
  if (!nb) return na;
  return mergeNormalizedRanges([...na, ...nb].sort((x, y) => x.start - y.start));
}

/**
 * Subtract ranges b from a. Both must be defined (line-mode semantics).
 * Example:
 *  a: [1,10], b:[3,4],[7,8] -> [1,2],[5,6],[9,10]
 */
export function subtractLineRanges(a: LineRange[], b: LineRange[]): LineRange[] | undefined {
  const A = normalizeRanges(a) ?? [];
  const B = normalizeRanges(b) ?? [];
  if (A.length === 0) return undefined;
  if (B.length === 0) return A;

  const out: LineRange[] = [];
  for (const ar of A) {
    let segments: LineRange[] = [{ ...ar }];
    for (const br of B) {
      const nextSegments: LineRange[] = [];
      for (const seg of segments) {
        // No overlap
        if (br.end < seg.start || br.start > seg.end) {
          nextSegments.push(seg);
          continue;
        }
        // Overlap: cut seg into up to two pieces
        if (br.start > seg.start) {
          nextSegments.push({ start: seg.start, end: br.start - 1 });
        }
        if (br.end < seg.end) {
          nextSegments.push({ start: br.end + 1, end: seg.end });
        }
      }
      segments = nextSegments;
      if (segments.length === 0) break;
    }
    out.push(...segments);
  }

  return normalizeRanges(out);
}

/**
 * Apply "select" mutations:
 * - If file not present: add { path, lines? } (lines undefined = whole file)
 * - If present and existing lines undefined (whole-file): KEEP whole-file (ignore additional line ranges)
 * - If present with lines:
 *   - next with no lines: UPGRADE to whole file (drop ranges)
 *   - next with lines: MERGE ranges
 */
export function applySelect(
  state: { selectedFiles?: SelectedFileReference[] } | undefined,
  items: SelectionItem[]
): { selectedFiles: SelectedFileReference[] } {
  const existing = new Map<string, SelectedFileReference>(
    (state?.selectedFiles ?? []).map((s) => [s.path, { path: s.path, lines: s.lines ? [...s.lines] : undefined }])
  );

  for (const item of items) {
    const normalizedLines = normalizeRanges(item.lines);
    const prev = existing.get(item.path);

    if (!prev) {
      existing.set(item.path, { path: item.path, lines: normalizedLines });
      continue;
    }

    // If previously whole-file (lines undefined), keep as whole-file regardless of new lines
    if (!prev.lines || prev.lines.length === 0) {
      existing.set(item.path, { path: item.path });
      continue;
    }

    // If new selection is whole-file, upgrade to whole-file
    if (!normalizedLines || normalizedLines.length === 0) {
      existing.set(item.path, { path: item.path });
      continue;
    }

    // Merge ranges
    const merged = mergeLineRanges(prev.lines, normalizedLines);
    existing.set(item.path, { path: item.path, lines: merged });
  }

  return { selectedFiles: [...existing.values()] };
}

/**
 * Apply "deselect" mutations:
 * - If file not present: no-op
 * - If no lines provided: remove file entirely
 * - If lines provided:
 *   - If existing selection is whole-file (lines undefined): not supported without file line count —> throws
 *   - If existing has lines: subtract; drop entry if nothing remains
 */
export function applyDeselect(
  state: { selectedFiles?: SelectedFileReference[] } | undefined,
  items: SelectionItem[]
): { selectedFiles: SelectedFileReference[] } {
  const existing = new Map<string, SelectedFileReference>(
    (state?.selectedFiles ?? []).map((s) => [s.path, { path: s.path, lines: s.lines ? [...s.lines] : undefined }])
  );

  for (const item of items) {
    const prev = existing.get(item.path);
    if (!prev) continue;

    const normalizedLines = normalizeRanges(item.lines);

    // No lines: remove the file entry outright
    if (!normalizedLines || normalizedLines.length === 0) {
      existing.delete(item.path);
      continue;
    }

    // Lines provided but existing was whole-file: we cannot compute "whole minus ranges" without file length
    if (!prev.lines || prev.lines.length === 0) {
      throw new SelectionServiceError(
        'PARTIAL_DESELECT_OF_WHOLE_FILE_NOT_SUPPORTED',
        'Cannot partially deselect a whole-file selection without file length context'
      );
    }

    const subtracted = subtractLineRanges(prev.lines, normalizedLines);
    if (!subtracted || subtracted.length === 0) {
      existing.delete(item.path);
    } else {
      existing.set(item.path, { path: item.path, lines: subtracted });
    }
  }

  return { selectedFiles: [...existing.values()] };
}