import { create } from 'zustand';

import type { FileData, LineRange, SelectedFileReference } from '../types/file-types';
import { buildFolderIndex, getFilesInFolder, type FolderIndex } from '../utils/folder-selection-index';

interface SelectionState {
  selectedFiles: SelectedFileReference[];
  folderIndex: FolderIndex | null;
}

interface SelectionActions {
  setSelectedFiles: (files: SelectedFileReference[] | ((prev: SelectedFileReference[]) => SelectedFileReference[])) => void;
  toggleFileSelection: (filePath: string, allFilesMap?: Map<string, FileData>) => void;
  toggleLineRange: (filePath: string, range: LineRange | undefined, allFilesMap?: Map<string, FileData>) => void;
  toggleFolderSelection: (folderPath: string, isSelected: boolean, allFilesMap?: Map<string, FileData>) => void;
  selectAllDisplayed: (displayedFiles: FileData[], allFilesMap?: Map<string, FileData>) => void;
  deselectAllDisplayed: (displayedFiles: FileData[]) => void;
  clearSelection: () => void;
  setSelection: (files: SelectedFileReference[]) => void;
  buildIndex: (allFiles: FileData[]) => void;
  isFileSelected: (filePath: string) => boolean;
  isFolderSelected: (folderPath: string) => boolean;
  getSelectedFileRefs: () => SelectedFileReference[];
}

function canSelectPath(path: string, allFilesMap?: Map<string, FileData>): boolean {
  if (!allFilesMap) return true;
  const file = allFilesMap.get(path);
  return !!file && !file.isBinary && !file.isSkipped;
}

export const useSelectionStore = create<SelectionState & SelectionActions>((set, get) => ({
  selectedFiles: [],
  folderIndex: null,

  setSelectedFiles: (files) => set((s) => ({
    selectedFiles: typeof files === 'function' ? files(s.selectedFiles) : files
  })),

  toggleFileSelection: (filePath, allFilesMap) => set((s) => {
    if (!canSelectPath(filePath, allFilesMap)) return s;
    const byPath = new Map(s.selectedFiles.map((f) => [f.path, f]));
    if (byPath.has(filePath)) {
      byPath.delete(filePath);
    } else {
      byPath.set(filePath, { path: filePath });
    }
    return { selectedFiles: [...byPath.values()] };
  }),

  toggleLineRange: (filePath, range, allFilesMap) => set((s) => {
    if (!range) {
      if (!canSelectPath(filePath, allFilesMap)) return s;
      const byPath = new Map(s.selectedFiles.map((f) => [f.path, f]));
      if (byPath.has(filePath)) {
        byPath.delete(filePath);
      } else {
        byPath.set(filePath, { path: filePath });
      }
      return { selectedFiles: [...byPath.values()] };
    }

    if (!canSelectPath(filePath, allFilesMap)) return s;
    const byPath = new Map(s.selectedFiles.map((f) => [f.path, f]));
    const existing = byPath.get(filePath);

    if (!existing) {
      byPath.set(filePath, { path: filePath, lines: [range] });
      return { selectedFiles: [...byPath.values()] };
    }

    const existingLines = existing.lines || [];
    const idx = existingLines.findIndex((x) => x.start === range.start && x.end === range.end);

    if (idx >= 0) {
      const nextLines = existingLines.filter((_, i) => i !== idx);
      if (nextLines.length === 0) {
        byPath.delete(filePath);
      } else {
        byPath.set(filePath, { path: filePath, lines: nextLines });
      }
    } else {
      byPath.set(filePath, { path: filePath, lines: [...existingLines, range] });
    }

    return { selectedFiles: [...byPath.values()] };
  }),

  toggleFolderSelection: (folderPath, isSelected, allFilesMap) => set((s) => {
    const index = s.folderIndex;
    if (!index) return s;

    const inFolder = getFilesInFolder(index, folderPath).filter((p) => canSelectPath(p, allFilesMap));
    const byPath = new Map(s.selectedFiles.map((f) => [f.path, f]));

    if (isSelected) {
      for (const p of inFolder) {
        byPath.delete(p);
      }
    } else {
      for (const p of inFolder) {
        if (!byPath.has(p)) {
          byPath.set(p, { path: p });
        }
      }
    }

    return { selectedFiles: [...byPath.values()] };
  }),

  selectAllDisplayed: (displayedFiles, allFilesMap) => set((s) => {
    const byPath = new Map(s.selectedFiles.map((f) => [f.path, f]));
    for (const file of displayedFiles) {
      if (file.isBinary || file.isSkipped) continue;
      if (!byPath.has(file.path) && canSelectPath(file.path, allFilesMap)) {
        byPath.set(file.path, { path: file.path });
      }
    }
    return { selectedFiles: [...byPath.values()] };
  }),

  deselectAllDisplayed: (displayedFiles) => set((s) => {
    const toRemove = new Set(displayedFiles.map((f) => f.path));
    return { selectedFiles: s.selectedFiles.filter((f) => !toRemove.has(f.path)) };
  }),

  clearSelection: () => set({ selectedFiles: [] }),

  setSelection: (files) => set({
    selectedFiles: files.filter((f) => f?.path).map((f) => ({ path: f.path, lines: f.lines })),
  }),

  buildIndex: (allFiles) => set({ folderIndex: buildFolderIndex(allFiles) }),

  isFileSelected: (filePath) => {
    const s = get();
    return s.selectedFiles.some((f) => f.path === filePath);
  },

  isFolderSelected: (folderPath) => {
    const s = get();
    if (!s.folderIndex) return false;
    const filesInFolder = getFilesInFolder(s.folderIndex, folderPath);
    if (filesInFolder.length === 0) return false;
    const selectedPaths = new Set(s.selectedFiles.map((f) => f.path));
    return filesInFolder.every((p) => selectedPaths.has(p));
  },

  getSelectedFileRefs: () => get().selectedFiles,
}));
