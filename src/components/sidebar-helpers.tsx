import { DirectorySelectionCache } from '../utils/selection-cache';

import { DropdownOption } from './dropdown';

/**
 * Creates the standard set of sort options for file listings.
 * @returns Array of dropdown options with labels and icons for each sort type
 */
export const createSortOptions = (): DropdownOption[] => [
  { value: 'default', label: 'Developer-Focused', icon: <span>↕</span> },
  { value: 'name-asc', label: 'Name (A–Z)', icon: <span>↑</span> },
  { value: 'name-desc', label: 'Name (Z–A)', icon: <span>↓</span> },
  { value: 'extension-asc', label: 'Extension (A–Z)', icon: <span>↑</span> },
  { value: 'extension-desc', label: 'Extension (Z–A)', icon: <span>↓</span> },
  { value: 'date-desc', label: 'Date Modified (Newest)', icon: <span>↓</span> },
  { value: 'date-asc', label: 'Date Modified (Oldest)', icon: <span>↑</span> },
];

/**
 * Checks if all files in the current view are selected.
 * Uses folder selection cache for optimized lookups when available.
 * @param folderSelectionCache - Optional cache for directory selection states
 * @param selectedFolder - Current selected folder path
 * @param allFilesLength - Total number of files in current view
 * @param selectedFilesLength - Number of currently selected files
 * @returns True if all files are selected, false otherwise
 */
export const checkAllFilesSelected = (
  folderSelectionCache: DirectorySelectionCache | undefined,
  selectedFolder: string | null | undefined,
  allFilesLength: number,
  selectedFilesLength: number
): boolean => {
  if (folderSelectionCache && selectedFolder) {
    const rootFolderState = folderSelectionCache.get(selectedFolder);
    return rootFolderState === 'full';
  }
  return allFilesLength > 0 && selectedFilesLength === allFilesLength;
};