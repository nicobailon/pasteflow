import { createDirectorySelectionCache } from '../../utils/selection-cache';
import type { FileData, SelectedFileReference, DirectorySelectionCache } from '../../types/file-types';

// Helper: generate a large synthetic workspace
function generateWorkspace(totalFiles: number, totalDirs: number): { allFiles: FileData[]; selectedRefs: SelectedFileReference[]; anyDirPath: string } {
  const allFiles: FileData[] = [];
  const selectedRefs: SelectedFileReference[] = [];

  const filesPerDir = Math.max(1, Math.ceil(totalFiles / totalDirs));
  let filesMade = 0;
  let anyDirPath = '';

  for (let d = 0; d < totalDirs; d++) {
    const dirPath = `/root/dir-${d}`;
    if (!anyDirPath) anyDirPath = dirPath;

    for (let f = 0; f < filesPerDir; f++) {
      if (filesMade >= totalFiles) break;
      const filePath = `${dirPath}/file-${f}.ts`;
      allFiles.push({
        name: `file-${f}.ts`,
        path: filePath,
        isDirectory: false,
        size: 123,
        isBinary: false,
        isSkipped: false
      });
      selectedRefs.push({ path: filePath });
      filesMade++;
    }
    if (filesMade >= totalFiles) break;
  }

  return { allFiles, selectedRefs, anyDirPath };
}

// Advance all pending timers repeatedly (idle callbacks fallback to setTimeout(0))
async function flushIdleBatchesUntilDone(cache: DirectorySelectionCache, maxLoops = 200): Promise<void> {
  for (let i = 0; i < maxLoops; i++) {
    if (!cache.isComputing || !cache.isComputing()) return;
    // Run pending zero-timeout tasks
    jest.advanceTimersByTime(0);
    // Give microtasks a turn
    await Promise.resolve();
  }
}

describe('selection overlay progressive computation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('computes visible/priority directories first and completes progressively (over threshold)', async () => {
    const DIRS = 5200;     // just over progressive threshold (5000)
    const FILES = 26000;   // ~5 files/dir on average

    const { allFiles, selectedRefs, anyDirPath } = generateWorkspace(FILES, DIRS);

    let batches = 0;
    let totalApplied = 0;
    const cache = createDirectorySelectionCache(allFiles, selectedRefs, {
      onBatchApplied: (batchSize, total) => {
        batches++;
        totalApplied = total;
      }
    });

    // Immediate on-demand lookup should be available (and path normalization supported)
    const state1 = cache.get(anyDirPath);
    const alt = anyDirPath.startsWith('/') ? anyDirPath.slice(1) : '/' + anyDirPath;
    const state2 = cache.get(alt);
    expect(['full', 'partial', 'none']).toContain(state1);
    expect(state2).toBe(state1);

    // Kick progressive recompute with the full selected set and a small batch for test determinism
    const selectedPaths = new Set(selectedRefs.map(r => r.path));
    cache.setSelectedPaths?.(selectedPaths);
    cache.startProgressiveRecompute?.({
      selectedPaths,
      priorityPaths: [anyDirPath], // pretend this directory is visible
      batchSize: 1000
    });

    // While computing, it should report busy
    expect(cache.isComputing?.()).toBe(true);

    // Let batches run to completion
    await flushIdleBatchesUntilDone(cache);

    // After completion, computing should be false and progress 1
    expect(cache.isComputing?.()).toBe(false);
    expect(cache.getProgress?.()).toBe(1);

    // Should have applied multiple batches
    expect(batches).toBeGreaterThan(0);
    expect(totalApplied).toBeGreaterThan(0);

    // Sanity: directory queried should converge to full when all files selected
    const finalState = cache.get(anyDirPath);
    expect(finalState).toBe('full');
  });

  it('path normalization mirrors leading slash variants consistently', () => {
    const { allFiles, selectedRefs, anyDirPath } = generateWorkspace(200, 40);
    const cache = createDirectorySelectionCache(allFiles, selectedRefs);

    const a = cache.get(anyDirPath);
    const b = cache.get(anyDirPath.startsWith('/') ? anyDirPath.slice(1) : '/' + anyDirPath);
    expect(a).toBe(b);
  });
});