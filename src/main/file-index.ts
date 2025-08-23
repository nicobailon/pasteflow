import fs from 'node:fs';
import path from 'node:path';

import type { FileData } from '../types/file-types';
import { loadGitignore } from '../utils/ignore-utils';
import { statFile } from './file-service';

type WorkspaceId = string;

export interface BuildOptions {
  fullScan?: boolean; // reserved for future incremental strategies
  exclusionPatterns?: string[];
}

export interface PathSearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}

/**
 * In-memory file index per workspace (NEVER persisted).
 * - Scans the active workspace folder using .gitignore + default excludes + user patterns.
 * - Stores only lightweight FileData entries (no content).
 * - Designed to support tree rendering and path-only search.
 */
export class FileIndexCache {
  private cache = new Map<WorkspaceId, { files: FileData[]; builtAt: number }>();
  private building = new Map<WorkspaceId, Promise<FileData[]>>();

  /**
   * Build (or rebuild) the index for a workspace. If a build is already in progress for the same workspace, returns that promise.
   */
  async build(workspaceId: WorkspaceId, folderPath: string, opts: BuildOptions = {}): Promise<FileData[]> {
    const inProgress = this.building.get(workspaceId);
    if (inProgress) return inProgress;

    const p = this.scanWorkspace(folderPath, opts).then((files) => {
      this.cache.set(workspaceId, { files, builtAt: Date.now() });
      this.building.delete(workspaceId);
      return files;
    }).catch((err) => {
      this.building.delete(workspaceId);
      throw err;
    });

    this.building.set(workspaceId, p);
    return p;
  }

  /**
   * Get current index for a workspace, or null if not built.
   */
  get(workspaceId: WorkspaceId): FileData[] | null {
    const entry = this.cache.get(workspaceId);
    return entry ? entry.files : null;
  }

  /**
   * Invalidate a workspace index (or all indexes if workspaceId omitted).
   */
  invalidate(workspaceId?: WorkspaceId): void {
    if (workspaceId) {
      this.cache.delete(workspaceId);
      this.building.delete(workspaceId);
    } else {
      this.cache.clear();
      this.building.clear();
    }
  }

  /**
   * Path-only search within the cached index (does NOT scan the disk).
   * Returns up to 'limit' matches, ordered by ascending path.
   */
  searchPath(workspaceId: WorkspaceId, term: string, opts: PathSearchOptions = {}): { path: string }[] {
    const files = this.get(workspaceId);
    if (!files) return [];

    const limit = Math.max(1, Math.min(opts.limit ?? 200, 10_000));
    const haystacks = files.map(f => f.path).sort();

    let matcher: (p: string) => boolean;
    if (opts.isRegex) {
      // Cap regex length for safety
      if (term.length > 256) {
        // Caller should map to SEARCH_TOO_BROAD
        return [];
      }
      let re: RegExp;
      try {
        re = new RegExp(term, opts.caseSensitive ? undefined : 'i');
      } catch {
        // Invalid regex - return no matches (caller may map to VALIDATION_ERROR)
        return [];
      }
      matcher = (p) => re.test(p);
    } else {
      const needle = opts.caseSensitive ? term : term.toLowerCase();
      matcher = (p) => {
        const t = opts.caseSensitive ? p : p.toLowerCase();
        return t.includes(needle);
      };
    }

    const matches: { path: string }[] = [];
    for (const p of haystacks) {
      if (matcher(p)) {
        matches.push({ path: p });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /**
   * Internal BFS scan of a workspace folder, respecting ignore filters.
   * Produces lightweight FileData entries (no content).
   */
  private async scanWorkspace(folderPath: string, opts: BuildOptions): Promise<FileData[]> {
    const ignoreFilter = loadGitignore(folderPath, opts.exclusionPatterns ?? []);
    const files: FileData[] = [];

    const queue: string[] = [folderPath];
    const seen = new Set<string>();

    while (queue.length) {
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);

      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const d of dirents) {
        const full = path.join(dir, d.name);
        const rel = path.relative(folderPath, full);

        if (ignoreFilter.ignores(rel)) continue;

        if (d.isDirectory()) {
          queue.push(full);
          continue;
        }
        if (!d.isFile()) continue;

        const st = await statFile(full);
        if (!st.ok) continue;
        if (st.data.isDirectory) continue;

        files.push({
          name: st.data.name,
          path: st.data.path,
          isDirectory: false,
          isContentLoaded: false, // content is never loaded in index
          tokenCount: undefined,
          children: undefined,
          content: undefined,
          size: st.data.size,
          mtimeMs: st.data.mtimeMs,
          isBinary: st.data.isBinary,
          isSkipped: false,
          error: undefined,
          fileType: st.data.fileType ?? undefined,
          excludedByDefault: ignoreFilter.ignores(rel),
          isCountingTokens: false,
          tokenCountError: undefined,
        });
      }
    }

    return files;
  }
}

let singleton: FileIndexCache | null = null;
/**
 * Global singleton accessor to share index across API routes
 */
export function getFileIndexCache(): FileIndexCache {
  if (!singleton) singleton = new FileIndexCache();
  return singleton;
}