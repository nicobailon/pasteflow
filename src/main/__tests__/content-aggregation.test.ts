/** @jest-environment node */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { aggregateSelectedContent } from '../content-aggregation';
import { setAllowedWorkspacePaths } from '../workspace-context';
import { getPathValidator } from '../../security/path-validator';
import type { SelectedFileReference } from '../../types/file-types';

function withTempDir(testFn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agg-'));
    try {
      await testFn(dir);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };
}

describe('content-aggregation — inclusion/pruning and fileCount stability', () => {
  test('includes only textual selected files and prunes binary/missing; returns stable fileCount', withTempDir(async (root) => {
    // Workspace security context
    setAllowedWorkspacePaths([root]);
    getPathValidator([root]);

    // Create files
    const textPath = path.join(root, 'a.txt');
    fs.writeFileSync(textPath, 'alpha\nbeta\n', 'utf8');

    const binPath = path.join(root, 'b.png');
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 4])); // binary by extension

    const missingPath = path.join(root, 'missing.txt'); // does not exist

    const selection: SelectedFileReference[] = [
      { path: textPath },
      { path: binPath },
      { path: missingPath },
    ];

    const { content, fileCount } = await aggregateSelectedContent({
      folderPath: root,
      selection,
      sortOrder: 'name',
      fileTreeMode: 'selected',
      selectedFolder: root,
      systemPrompts: [],
      rolePrompts: [],
      selectedInstructions: [],
      userInstructions: '',
      exclusionPatterns: [],
    });

    // Assertions — ensure only text file included
    expect(fileCount).toBe(1);
    expect(content.includes('alpha')).toBe(true);
    // Should not include any accidental placeholders or binary markers
    expect(content.toLowerCase().includes('binary')).toBe(false);
  }));

  test('all selections pruned -> fileCount=0 and content indicates no files selected', withTempDir(async (root) => {
    setAllowedWorkspacePaths([root]);
    getPathValidator([root]);

    const missing = path.join(root, 'does-not-exist.md');
    const selection: SelectedFileReference[] = [{ path: missing }];

    const { content, fileCount } = await aggregateSelectedContent({
      folderPath: root,
      selection,
      sortOrder: 'name',
      fileTreeMode: 'selected',
      selectedFolder: root,
      systemPrompts: [],
      rolePrompts: [],
      selectedInstructions: [],
      userInstructions: '',
      exclusionPatterns: [],
    });

    expect(fileCount).toBe(0);
    expect(content.includes('No files selected.')).toBe(true);
  }));
});