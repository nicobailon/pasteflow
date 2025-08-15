import React from 'react';
import { createSortOptions, checkAllFilesSelected } from '../components/sidebar-helpers';
import { DirectorySelectionCache } from '../utils/selection-cache';

describe('sidebar-helpers', () => {
  describe('createSortOptions', () => {
    it('should create all expected sort options with correct properties', () => {
      const options = createSortOptions();
      
      expect(options).toHaveLength(7);
      expect(options.every(opt => opt.value && opt.label && opt.icon)).toBe(true);
    });

    it('should include developer-focused as default option', () => {
      const options = createSortOptions();
      const defaultOption = options.find(opt => opt.value === 'default');
      
      expect(defaultOption).toBeDefined();
      expect(defaultOption?.label).toBe('Developer-Focused');
      expect(React.isValidElement(defaultOption?.icon)).toBe(true);
    });

    it('should include both ascending and descending name sort options', () => {
      const options = createSortOptions();
      const nameAsc = options.find(opt => opt.value === 'name-asc');
      const nameDesc = options.find(opt => opt.value === 'name-desc');
      
      expect(nameAsc).toBeDefined();
      expect(nameAsc?.label).toBe('Name (A–Z)');
      expect(nameDesc).toBeDefined();
      expect(nameDesc?.label).toBe('Name (Z–A)');
    });

    it('should include both ascending and descending extension sort options', () => {
      const options = createSortOptions();
      const extAsc = options.find(opt => opt.value === 'extension-asc');
      const extDesc = options.find(opt => opt.value === 'extension-desc');
      
      expect(extAsc).toBeDefined();
      expect(extAsc?.label).toBe('Extension (A–Z)');
      expect(extDesc).toBeDefined();
      expect(extDesc?.label).toBe('Extension (Z–A)');
    });

    it('should include both newest and oldest date sort options', () => {
      const options = createSortOptions();
      const dateDesc = options.find(opt => opt.value === 'date-desc');
      const dateAsc = options.find(opt => opt.value === 'date-asc');
      
      expect(dateDesc).toBeDefined();
      expect(dateDesc?.label).toBe('Date Modified (Newest)');
      expect(dateAsc).toBeDefined();
      expect(dateAsc?.label).toBe('Date Modified (Oldest)');
    });

    it('should have appropriate icons for each sort direction', () => {
      const options = createSortOptions();
      
      const ascOptions = options.filter(opt => opt.value.includes('-asc'));
      const descOptions = options.filter(opt => opt.value.includes('-desc'));
      const defaultOption = options.find(opt => opt.value === 'default');
      
      expect(ascOptions).toHaveLength(3);
      expect(descOptions).toHaveLength(3);
      expect(defaultOption).toBeDefined();
      ascOptions.forEach(opt => expect(React.isValidElement(opt.icon)).toBe(true));
      descOptions.forEach(opt => expect(React.isValidElement(opt.icon)).toBe(true));
    });

    it('should always return the same order of options', () => {
      const options1 = createSortOptions();
      const options2 = createSortOptions();
      
      expect(options1.map(o => o.value)).toEqual(options2.map(o => o.value));
      expect(options1.map(o => o.label)).toEqual(options2.map(o => o.label));
    });
  });

  describe('checkAllFilesSelected', () => {
    it('should return false when no files exist', () => {
      const result = checkAllFilesSelected(
        undefined,
        null,
        0,
        0
      );
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should return true when all files are selected without cache', () => {
      const result = checkAllFilesSelected(
        undefined,
        null,
        10,
        10
      );
      
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should return false when only some files are selected without cache', () => {
      const result = checkAllFilesSelected(
        undefined,
        null,
        10,
        5
      );
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should use cache when both cache and folder are provided', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn().mockReturnValue('full'),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        '/test/folder',
        10,
        5
      );
      
      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalledWith('/test/folder');
      expect(mockCache.get).toHaveBeenCalledTimes(1);
    });

    it('should return true when cache indicates full selection', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn().mockReturnValue('full'),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        '/test/folder',
        100,
        50
      );
      
      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalledWith('/test/folder');
    });

    it('should return false when cache indicates partial selection', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn().mockReturnValue('partial'),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        '/test/folder',
        100,
        100
      );
      
      expect(result).toBe(false);
      expect(mockCache.get).toHaveBeenCalledWith('/test/folder');
    });

    it('should return false when cache indicates no selection', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn().mockReturnValue('none'),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        '/test/folder',
        100,
        100
      );
      
      expect(result).toBe(false);
      expect(mockCache.get).toHaveBeenCalledWith('/test/folder');
    });

    it('should fall back to count comparison when cache exists but folder is null', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn(),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        null,
        10,
        10
      );
      
      expect(result).toBe(true);
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('should fall back to count comparison when cache exists but folder is undefined', () => {
      const mockCache: DirectorySelectionCache = {
        get: jest.fn(),
        set: jest.fn(),
        bulkUpdate: jest.fn(),
        clear: jest.fn()
      };
      
      const result = checkAllFilesSelected(
        mockCache,
        undefined,
        15,
        10
      );
      
      expect(result).toBe(false);
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('should handle edge case with negative file counts', () => {
      const result = checkAllFilesSelected(
        undefined,
        null,
        -1,
        -1
      );
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should handle edge case where selected files exceed total files', () => {
      const result = checkAllFilesSelected(
        undefined,
        null,
        10,
        15
      );
      
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });
  });
});