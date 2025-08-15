import { DirectorySelectionCache } from '../utils/selection-cache';

import { DropdownOption } from './dropdown';

export const createSortOptions = (): DropdownOption[] => [
  { value: 'default', label: 'Developer-Focused', icon: <span>↕</span> },
  { value: 'name-asc', label: 'Name (A–Z)', icon: <span>↑</span> },
  { value: 'name-desc', label: 'Name (Z–A)', icon: <span>↓</span> },
  { value: 'extension-asc', label: 'Extension (A–Z)', icon: <span>↑</span> },
  { value: 'extension-desc', label: 'Extension (Z–A)', icon: <span>↓</span> },
  { value: 'date-desc', label: 'Date Modified (Newest)', icon: <span>↓</span> },
  { value: 'date-asc', label: 'Date Modified (Oldest)', icon: <span>↑</span> },
];

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