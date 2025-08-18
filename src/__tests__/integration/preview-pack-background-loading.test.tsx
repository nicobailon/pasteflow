import { render, waitFor } from '@testing-library/react';
import ContentArea from '../../components/content-area';
import { FileData, SelectedFileReference } from '../../types/file-types';
import { TOKEN_COUNTING } from '../../constants/app-constants';

// Mock the feature flags
jest.mock('../../constants/app-constants', () => ({
  ...jest.requireActual('../../constants/app-constants'),
  FEATURES: {
    PREVIEW_PACK_ENABLED: true,
    PREVIEW_WORKER_ENABLED: true,
  },
}));

// Mock loadFileContent
const mockLoadFileContent = jest.fn();

// Mock usePreviewPack hook
const mockPushFileUpdates = jest.fn();
jest.mock('../../hooks/use-preview-pack', () => ({
  usePreviewPack: jest.fn(() => ({
    pack: jest.fn(),
    cancelPack: jest.fn(),
    packState: {
      status: 'packing',
      processed: 0,
      total: 10,
      percent: 0,
      tokenEstimate: 0,
      signature: 'test-sig',
    },
    previewState: {
      id: 'test-id',
      status: 'loading',
      processed: 0,
      total: 10,
      percent: 0,
      tokenEstimate: 0,
      contentForDisplay: '',
      fullContent: '',
    },
    pushFileUpdates: mockPushFileUpdates,
    copyText: '',
    startPreview: jest.fn(),
  })),
}));

describe('Preview Pack Background Loading', () => {
  const createMockFile = (path: string, isContentLoaded: boolean, content?: string): FileData => ({
    name: path.split('/').pop() || '',
    path,
    isDirectory: false,
    size: 100,
    isBinary: false,
    isSkipped: false,
    isContentLoaded,
    content,
    tokenCount: content ? Math.ceil(content.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : undefined,
  });

  const defaultProps = {
    selectedFiles: [] as SelectedFileReference[],
    allFiles: [] as FileData[],
    toggleFileSelection: jest.fn(),
    toggleSelection: jest.fn(),
    openFolder: jest.fn(),
    onViewFile: jest.fn(),
    processingStatus: { status: 'idle' as const, message: '' },
    selectedSystemPrompts: [],
    toggleSystemPromptSelection: jest.fn(),
    selectedRolePrompts: [],
    toggleRolePromptSelection: jest.fn(),
    selectedInstructions: [],
    toggleInstructionSelection: jest.fn(),
    sortOrder: 'name',
    handleSortChange: jest.fn(),
    sortDropdownOpen: false,
    toggleSortDropdown: jest.fn(),
    sortOptions: [{ value: 'name', label: 'Name' }],
    getSelectedFilesContent: jest.fn(() => ''),
    calculateTotalTokens: jest.fn(() => 0),
    instructionsTokenCount: 0,
    userInstructions: '',
    setUserInstructions: jest.fn(),
    fileTreeTokens: 0,
    systemPromptTokens: 0,
    rolePromptTokens: 0,
    instructionsTokens: 0,
    setSystemPromptsModalOpen: jest.fn(),
    setRolePromptsModalOpen: jest.fn(),
    setInstructionsModalOpen: jest.fn(),
    loadFileContent: mockLoadFileContent,
    clipboardPreviewModalOpen: false,
    previewContent: '',
    previewTokenCount: 0,
    openClipboardPreviewModal: jest.fn(),
    closeClipboardPreviewModal: jest.fn(),
    selectedFolder: null,
    expandedNodes: {},
    toggleExpanded: jest.fn(),
    fileTreeMode: 'none' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadFileContent.mockImplementation(() => Promise.resolve());
  });

  describe('Background Loading During Pack', () => {
    it('should load file content when packing with modal closed', async () => {
      const file1 = createMockFile('/test1.js', false);
      const file2 = createMockFile('/test2.js', false);
      
      const props = {
        ...defaultProps,
        selectedFiles: [
          { path: '/test1.js', lines: undefined },
          { path: '/test2.js', lines: undefined },
        ],
        allFiles: [file1, file2],
        clipboardPreviewModalOpen: false, // Modal is closed
      };

      render(<ContentArea {...props} />);

      // Wait for background loading to trigger
      await waitFor(() => {
        expect(mockLoadFileContent).toHaveBeenCalledWith('/test1.js');
        expect(mockLoadFileContent).toHaveBeenCalledWith('/test2.js');
      });
    });

    it('should push file updates to worker when content is loaded', async () => {
      const file1 = createMockFile('/test1.js', true, 'console.log("test1");');
      const file2 = createMockFile('/test2.js', true, 'console.log("test2");');
      
      const props = {
        ...defaultProps,
        selectedFiles: [
          { path: '/test1.js', lines: undefined },
          { path: '/test2.js', lines: undefined },
        ],
        allFiles: [file1, file2],
        clipboardPreviewModalOpen: false, // Modal is closed
      };

      render(<ContentArea {...props} />);

      // Wait for pushFileUpdates to be called
      await waitFor(() => {
        expect(mockPushFileUpdates).toHaveBeenCalled();
      });

      // Check that files were pushed with correct content
      const calls = mockPushFileUpdates.mock.calls;
      const allUpdates = calls.flat();
      
      expect(allUpdates).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              path: '/test1.js',
              content: 'console.log("test1");',
              tokenCount: expect.any(Number),
            }),
            expect.objectContaining({
              path: '/test2.js',
              content: 'console.log("test2");',
              tokenCount: expect.any(Number),
            }),
          ]),
        ])
      );
    });

    it('should not load binary or skipped files', async () => {
      const binaryFile = createMockFile('/image.png', false);
      binaryFile.isBinary = true;
      
      const skippedFile = createMockFile('/skip.txt', false);
      skippedFile.isSkipped = true;
      
      const normalFile = createMockFile('/normal.js', false);
      
      const props = {
        ...defaultProps,
        selectedFiles: [
          { path: '/image.png', lines: undefined },
          { path: '/skip.txt', lines: undefined },
          { path: '/normal.js', lines: undefined },
        ],
        allFiles: [binaryFile, skippedFile, normalFile],
        clipboardPreviewModalOpen: false,
      };

      render(<ContentArea {...props} />);

      await waitFor(() => {
        expect(mockLoadFileContent).toHaveBeenCalledWith('/normal.js');
      });

      // Binary and skipped files should not be loaded
      expect(mockLoadFileContent).not.toHaveBeenCalledWith('/image.png');
      expect(mockLoadFileContent).not.toHaveBeenCalledWith('/skip.txt');
    });

    it('should handle large file batches with adaptive pacing', async () => {
      // Create 100 files
      const files: FileData[] = [];
      const selectedFiles: SelectedFileReference[] = [];
      
      for (let i = 0; i < 100; i++) {
        files.push(createMockFile(`/file${i}.js`, false));
        selectedFiles.push({ path: `/file${i}.js`, lines: undefined });
      }
      
      const props = {
        ...defaultProps,
        selectedFiles,
        allFiles: files,
        clipboardPreviewModalOpen: false,
      };

      render(<ContentArea {...props} />);

      // Files should be loaded in batches
      await waitFor(() => {
        expect(mockLoadFileContent).toHaveBeenCalled();
      });

      // Should load all 100 files eventually
      await waitFor(() => {
        expect(mockLoadFileContent).toHaveBeenCalledTimes(100);
      }, { timeout: 5000 });
    });
  });

  describe('Pack State Changes', () => {
    it('should clear lastPushedRef when pack starts', async () => {
      const file1 = createMockFile('/test1.js', true, 'content1');
      
      const props = {
        ...defaultProps,
        selectedFiles: [{ path: '/test1.js', lines: undefined }],
        allFiles: [file1],
        clipboardPreviewModalOpen: false,
      };

      const { rerender } = render(<ContentArea {...props} />);

      // First render with packing state
      await waitFor(() => {
        expect(mockPushFileUpdates).toHaveBeenCalled();
      });

      // Clear mocks
      mockPushFileUpdates.mockClear();

      // Update packState to idle then back to packing
      const { usePreviewPack } = require('../../hooks/use-preview-pack');
      usePreviewPack.mockReturnValue({
        ...usePreviewPack(),
        packState: {
          status: 'idle',
          processed: 0,
          total: 0,
          percent: 0,
          tokenEstimate: 0,
          signature: 'test-sig',
        },
      });

      rerender(<ContentArea {...props} />);

      // Back to packing
      usePreviewPack.mockReturnValue({
        ...usePreviewPack(),
        packState: {
          status: 'packing',
          processed: 0,
          total: 10,
          percent: 0,
          tokenEstimate: 0,
          signature: 'test-sig-2',
        },
      });

      rerender(<ContentArea {...props} />);

      // Should push file updates again (lastPushedRef was cleared)
      await waitFor(() => {
        expect(mockPushFileUpdates).toHaveBeenCalled();
      });
    });

    it('should continue loading when packState is ready', async () => {
      const { usePreviewPack } = require('../../hooks/use-preview-pack');
      usePreviewPack.mockReturnValue({
        ...usePreviewPack(),
        packState: {
          status: 'ready',
          processed: 10,
          total: 10,
          percent: 100,
          tokenEstimate: 100,
          signature: 'test-sig',
          fullContent: 'packed content',
        },
        previewState: {
          id: 'test-id',
          status: 'complete',
          processed: 10,
          total: 10,
          percent: 100,
          tokenEstimate: 100,
          contentForDisplay: 'packed content',
          fullContent: 'packed content',
        },
      });

      const file1 = createMockFile('/test1.js', true, 'content1');
      
      const props = {
        ...defaultProps,
        selectedFiles: [{ path: '/test1.js', lines: undefined }],
        allFiles: [file1],
        clipboardPreviewModalOpen: false,
      };

      render(<ContentArea {...props} />);

      // Should still push updates when ready
      await waitFor(() => {
        expect(mockPushFileUpdates).toHaveBeenCalled();
      });
    });
  });
});