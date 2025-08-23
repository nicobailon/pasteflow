import fs from 'node:fs';
import path from 'node:path';
import type { FileData } from '../types/file-types';
import { readTextFile } from './file-service';

export interface SearchOptions {
  term: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  includeContent?: boolean;
  pathOnly?: boolean;
  limit?: number;          // total matches limit (applies to path or content results)
  maxFileBytes?: number;   // per-file cap for content search
}

export interface SearchMatch {
  path: string;
  line?: number;
  preview?: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

/**
 * High-level search across a workspace index. Path-only search is expected to be
 * handled by FileIndexCache.searchPath() in the caller for performance. This service
 * provides content search over text files using readTextFile() safeguards.
 */
export class SearchService {
  private readonly DEFAULT_LIMIT = 200;
  private readonly DEFAULT_MAX_FILE_BYTES = 256 * 1024; // 256 KiB
  private readonly MAX_TOTAL_FILES = 1000;

  /**
   * Content search over a set of indexed files. Respects size/binary checks and caps.
   * Note: The provided files list should come from the in-memory index and MUST NOT include directories.
   */
  async contentSearch(files: FileData[], opts: SearchOptions): Promise<SearchResult> {
    const limit = Math.max(1, Math.min(opts.limit ?? this.DEFAULT_LIMIT, 10_000));
    const maxFileBytes = Math.max(1, Math.min(opts.maxFileBytes ?? this.DEFAULT_MAX_FILE_BYTES, 5 * 1024 * 1024)); // hard upper bound 5MB

    const matches: SearchMatch[] = [];
    let truncated = false;

    // Pre-compile matcher
    const matcher = this.buildMatcher(opts.term, { isRegex: !!opts.isRegex, caseSensitive: !!opts.caseSensitive });
    if (!matcher) {
      // Invalid regex -> return empty, let caller convert to VALIDATION_ERROR if desired
      return { matches: [], truncated: false };
    }

    // Filter candidate files (skip known binaries and directories)
    const candidates = files
      .filter(f => !f.isDirectory && !f.isBinary)
      .slice(0, this.MAX_TOTAL_FILES); // cap scanned files

    for (const f of candidates) {
      // Fast size gate before attempting to read
      try {
        const st = await fs.promises.stat(f.path);
        if (st.size > maxFileBytes) {
          continue; // skip oversized files for content search
        }
      } catch {
        continue; // stat failures -> skip
      }

      const rr = await readTextFile(f.path);
      if (!rr.ok || rr.isLikelyBinary) {
        continue;
      }

      const lines = rr.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (this.testLine(matcher, lineText)) {
          matches.push({
            path: f.path,
            line: i + 1,
            preview: this.buildPreview(lineText, 200),
          });
          if (matches.length >= limit) {
            truncated = true;
            return { matches, truncated };
          }
        }
      }
    }

    return { matches, truncated };
  }

  private buildMatcher(term: string, opts: { isRegex: boolean; caseSensitive: boolean }): ((s: string) => boolean) | null {
    if (opts.isRegex) {
      if (term.length > 256) return null;
      try {
        const re = new RegExp(term, opts.caseSensitive ? undefined : 'i');
        return (s: string) => re.test(s);
      } catch {
        return null;
      }
    }
    const needle = opts.caseSensitive ? term : term.toLowerCase();
    return (s: string) => {
      const hay = opts.caseSensitive ? s : s.toLowerCase();
      return hay.includes(needle);
    };
  }

  private testLine(matcher: (s: string) => boolean, line: string): boolean {
    try {
      return matcher(line);
    } catch {
      return false;
    }
  }

  private buildPreview(line: string, maxLen: number): string {
    if (line.length <= maxLen) return line;
    const half = Math.floor(maxLen / 2);
    return line.slice(0, half) + ' … ' + line.slice(line.length - half);
  }
}