import { getSelectedFilesContent } from '../../utils/content-formatter';
import { FileData, SelectedFileReference } from '../../types/file-types';

describe('Content Formatter Placeholders', () => {
  const createFile = (overrides: Partial<FileData>): FileData => ({
    path: '/test/file.txt',
    name: 'file.txt',
    isDirectory: false,
    isBinary: false,
    isContentLoaded: false,
    isSkipped: false,
    size: 100,
    ...overrides
  });

  it('should render binary placeholder for binary files', () => {
    const files: FileData[] = [
      createFile({ 
        path: '/test/binary.bin',
        name: 'binary.bin',
        isBinary: true, 
        fileType: 'bin' 
      })
    ];
    const selectedFiles: SelectedFileReference[] = [{ path: '/test/binary.bin' }];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain('[Binary file omitted: bin]');
    expect(result).not.toContain('[Content is loading...]');
  });

  it('should render skipped placeholder for skipped files', () => {
    const files: FileData[] = [
      createFile({ 
        path: '/test/skipped.txt',
        name: 'skipped.txt',
        isSkipped: true,
        error: 'File too large'
      })
    ];
    const selectedFiles: SelectedFileReference[] = [{ path: '/test/skipped.txt' }];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain('[File skipped: File too large]');
    expect(result).not.toContain('[Content is loading...]');
  });

  it('should render error placeholder for files with load errors', () => {
    const files: FileData[] = [
      createFile({ 
        path: '/test/error.txt',
        name: 'error.txt',
        error: 'Permission denied',
        isContentLoaded: false
      })
    ];
    const selectedFiles: SelectedFileReference[] = [{ path: '/test/error.txt' }];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain('[Failed to load file: Permission denied]');
    expect(result).not.toContain('[Content is loading...]');
  });

  it('should render loading placeholder for files not yet loaded', () => {
    const files: FileData[] = [
      createFile({ 
        path: '/test/loading.txt',
        name: 'loading.txt',
        isContentLoaded: false,
        error: undefined
      })
    ];
    const selectedFiles: SelectedFileReference[] = [{ path: '/test/loading.txt' }];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain('[Content is loading...]');
  });

  it('should include real content for loaded text files', () => {
    const fileContent = 'This is the actual file content';
    const files: FileData[] = [
      createFile({ 
        path: '/test/loaded.txt',
        name: 'loaded.txt',
        isContentLoaded: true,
        content: fileContent,
        tokenCount: 5
      })
    ];
    const selectedFiles: SelectedFileReference[] = [{ path: '/test/loaded.txt' }];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain(fileContent);
    expect(result).not.toContain('[Content is loading...]');
    expect(result).not.toContain('[Binary file omitted');
    expect(result).not.toContain('[File skipped');
    expect(result).not.toContain('[Failed to load file');
  });

  it('should handle multiple files with different states', () => {
    const files: FileData[] = [
      createFile({ 
        path: '/test/loaded.txt',
        name: 'loaded.txt',
        isContentLoaded: true,
        content: 'Loaded content'
      }),
      createFile({ 
        path: '/test/binary.jpg',
        name: 'binary.jpg',
        isBinary: true,
        fileType: 'jpg'
      }),
      createFile({ 
        path: '/test/loading.txt',
        name: 'loading.txt',
        isContentLoaded: false
      })
    ];
    const selectedFiles: SelectedFileReference[] = [
      { path: '/test/loaded.txt' },
      { path: '/test/binary.jpg' },
      { path: '/test/loading.txt' }
    ];
    
    const result = getSelectedFilesContent(
      files, 
      selectedFiles, 
      'alphabetical', 
      'none', 
      null, 
      [], 
      [], 
      [], 
      ''
    );
    
    expect(result).toContain('Loaded content');
    expect(result).toContain('[Binary file omitted: jpg]');
    expect(result).toContain('[Content is loading...]');
  });
});