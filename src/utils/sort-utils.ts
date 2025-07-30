import { FileData } from '../types/file-types';

/**
 * Maps file tree sort options to content sort options
 */
export const mapFileTreeSortToContentSort = (fileTreeSort: string): string => {
  // Direct mapping for most options
  switch (fileTreeSort) {
    case 'default': {
      return 'default-desc';
    }
    case 'name-asc':
    case 'name-desc':
    case 'extension-asc':
    case 'extension-desc':
    case 'date-asc':
    case 'date-desc': {
      return fileTreeSort;
    }
    default: {
      return 'name-asc';
    }
  }
};

/**
 * Developer-focused priority sorting for files
 */
const getFilePriority = (fileName: string): number => {
  const name = fileName.toLowerCase();
  
  // Configuration files
  if (/vite\.config\.ts$/i.test(name) || 
      /tsconfig\.json$/i.test(name) ||
      /package\.json$/i.test(name)) {
    return 1;
  }
  
  // Documentation
  if (/^readme\.md$/i.test(name)) return 2;
  
  // Entry points
  if (/^(main|index)\.(js|ts|tsx)$/i.test(name)) return 3;
  
  // Everything else
  return 100;
};

/**
 * Unified sorting function supporting all sort options
 */
export const sortFilesByOrder = (files: FileData[], sortOrder: string): FileData[] => {
  if (sortOrder === 'default-desc' || sortOrder === 'default') {
    // Developer-focused sorting
    return [...files].sort((a, b) => {
      const aPriority = getFilePriority(a.name);
      const bPriority = getFilePriority(b.name);
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a.name.localeCompare(b.name);
    });
  }

  const [sortKey, sortDir] = sortOrder.split("-");
  return [...files].sort((a: FileData, b: FileData) => {
    let comparison = 0;

    switch (sortKey) {
      case "name": {
        comparison = a.name.localeCompare(b.name);
        break;
      }
      case "tokens": {
        comparison = (a.tokenCount || 0) - (b.tokenCount || 0);
        break;
      }
      case "size": {
        comparison = a.size - b.size;
        break;
      }
      case "extension": {
        const aExt = a.name.split('.').pop() || '';
        const bExt = b.name.split('.').pop() || '';
        comparison = aExt.localeCompare(bExt) || a.name.localeCompare(b.name);
        break;
      }
      case "date": {
        // TODO: Add modifiedDate to FileData interface
        // For now, fallback to size-based sorting
        comparison = a.size - b.size;
        break;
      }
    }

    return sortDir === "asc" ? comparison : -comparison;
  });
};