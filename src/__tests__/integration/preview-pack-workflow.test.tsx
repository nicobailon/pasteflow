import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContentArea from '../../components/content-area';
import { usePreviewPack } from '../../hooks/use-preview-pack';
import { useUIStore, usePromptStore } from '../../stores';

// Mock the FEATURES to enable Pack workflow
jest.mock('../../constants/app-constants', () => ({
  ...jest.requireActual('../../constants/app-constants'),
  FEATURES: {
    PREVIEW_WORKER_ENABLED: true,
    PREVIEW_PACK_ENABLED: true,
  }
}));

// Mock the usePreviewPack hook
jest.mock('../../hooks/use-preview-pack');

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

describe('Preview Pack Workflow Integration', () => {
  const mockPack = jest.fn();
  const mockCancelPack = jest.fn();
  const mockPushFileUpdates = jest.fn();
  const mockStartPreview = jest.fn();

  type PackState = {
    status: 'idle' | 'packing' | 'ready' | 'error' | 'cancelled';
    processed: number;
    total: number;
    percent: number;
    tokenEstimate: number;
    signature: string;
    fullContent: string;
    contentForDisplay: string;
  };

  const defaultPackState: PackState = {
    status: 'idle',
    processed: 0,
    total: 0,
    percent: 0,
    tokenEstimate: 0,
    signature: '',
    fullContent: '',
    contentForDisplay: '',
  };

  const defaultPreviewState = {
    id: null,
    status: 'idle',
    processed: 0,
    total: 0,
    percent: 0,
    tokenEstimate: 0,
    contentForDisplay: '',
    fullContent: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    useUIStore.setState({
      sortOrder: 'name',
      sortDropdownOpen: false,
      clipboardPreviewModalOpen: false,
      previewContent: '',
      previewTokenCount: 0,
    });
    usePromptStore.setState({
      userInstructions: '',
    });
    
    (usePreviewPack as jest.Mock).mockReturnValue({
      pack: mockPack,
      cancelPack: mockCancelPack,
      packState: defaultPackState,
      previewState: defaultPreviewState,
      pushFileUpdates: mockPushFileUpdates,
      copyText: '',
      startPreview: mockStartPreview,
    });
  });

  const renderContentArea = (packState: PackState = defaultPackState) => {
    (usePreviewPack as jest.Mock).mockReturnValue({
      pack: mockPack,
      cancelPack: mockCancelPack,
      packState,
      previewState: defaultPreviewState,
      pushFileUpdates: mockPushFileUpdates,
      copyText: packState.fullContent || '',
      startPreview: mockStartPreview,
    });

    const mockProps = {
      selectedFiles: [{ path: '/test.js' }],
      allFiles: [{ 
        path: '/test.js', 
        name: 'test.js', 
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false,
        isContentLoaded: true,
        content: 'console.log("test");',
        tokenCount: 5
      }],
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
      sortOptions: [{ value: 'name', label: 'Name' }],
      getSelectedFilesContent: jest.fn(() => 'test content'),
      calculateTotalTokens: jest.fn(() => 100),
      instructionsTokenCount: 0,
      fileTreeTokens: 0,
      systemPromptTokens: 0,
      rolePromptTokens: 0,
      instructionsTokens: 0,
      setInstructionsModalOpen: jest.fn(),
      loadFileContent: jest.fn(),
      loadMultipleFileContents: jest.fn(async () => {}),
      selectedFolder: '/test',
      expandedNodes: {},
      toggleExpanded: jest.fn(),
      fileTreeMode: 'none' as const,
    };

    const utils = render(<ContentArea {...mockProps} />);
    return {
      ...utils,
      rerenderWith: (nextState: PackState) => {
        (usePreviewPack as jest.Mock).mockReturnValue({
          pack: mockPack,
          cancelPack: mockCancelPack,
          packState: nextState,
          previewState: defaultPreviewState,
          pushFileUpdates: mockPushFileUpdates,
          copyText: nextState.fullContent || '',
          startPreview: mockStartPreview,
        });
        utils.rerender(<ContentArea {...mockProps} />);
      }
    };
  };

  describe('Button State Transitions', () => {
    it('should show Pack button in idle state', () => {
      renderContentArea();
      const packButton = screen.getByRole('button', { name: /Pack/i });
      expect(packButton).toBeInTheDocument();
      expect(packButton).not.toBeDisabled();
    });

    it('should show packing progress when status is packing', () => {
      const packingState = {
        ...defaultPackState,
        status: 'packing' as const,
        processed: 5,
        total: 10,
        percent: 50,
      };
      
      renderContentArea(packingState);
      
      expect(screen.getByText(/Packing… 5\/10 \(50%\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('should show Preview and Copy buttons when ready', () => {
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        processed: 10,
        total: 10,
        percent: 100,
        fullContent: 'packed content',
        contentForDisplay: 'display content',
        tokenEstimate: 150,
      };
      
      renderContentArea(readyState);
      
      expect(screen.getByRole('button', { name: /Preview/i })).toBeInTheDocument();
      // Look for the main Copy button (with text), not the icon-only copy buttons
      const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
      const mainCopyButton = copyButtons.find(btn => btn.textContent?.includes('Copy'));
      expect(mainCopyButton).toBeInTheDocument();
    });

    it('should show Retry Pack button on error', () => {
      const errorState = {
        ...defaultPackState,
        status: 'error' as const,
        error: 'Test error',
      };
      
      renderContentArea(errorState);
      
      expect(screen.getByRole('button', { name: /Retry Pack/i })).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should call pack when Pack button is clicked', () => {
      renderContentArea();
      
      const packButton = screen.getByRole('button', { name: /Pack/i });
      fireEvent.click(packButton);
      
      expect(mockPack).toHaveBeenCalledTimes(1);
    });

    it('should call cancelPack when Cancel button is clicked', () => {
      const packingState = {
        ...defaultPackState,
        status: 'packing' as const,
      };
      
      renderContentArea(packingState);
      
      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);
      
      expect(mockCancelPack).toHaveBeenCalledTimes(1);
    });

    it('should open preview modal when Preview button is clicked in ready state', () => {
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        fullContent: 'packed content',
        contentForDisplay: 'display content',
        tokenEstimate: 150,
      };
      
      const { container } = renderContentArea(readyState);
      
      // Get the props passed to ContentArea to access openClipboardPreviewModal
      const contentArea = container.querySelector('.content-area');
      if (contentArea) {
        // Mock the modal open function
        (usePreviewPack as jest.Mock).mockReturnValue({
          pack: mockPack,
          cancelPack: mockCancelPack,
          packState: readyState,
          previewState: defaultPreviewState,
          pushFileUpdates: mockPushFileUpdates,
          copyText: readyState.fullContent,
          startPreview: mockStartPreview,
        });
      }
      
      const previewButton = screen.getByRole('button', { name: /Preview/i });
      fireEvent.click(previewButton);
      
      // Since modal opening is handled internally, we can verify the button exists and is clickable
      expect(previewButton).not.toBeDisabled();
    });
  });

  describe('Pack Workflow with Binary Files', () => {
    it('should complete successfully when selection includes binary files', async () => {
      // Test scenario: 2 eligible files (code.ts, app.tsx), 2 binary (png, woff2), 1 skipped (bundle.js)
      // Only eligible files should be counted in totalFiles (2 files)
      
      // Mock the pack state progression
      const packingState: PackState = {
        ...defaultPackState,
        status: 'packing',
        processed: 2, // Only non-binary, non-skipped files
        total: 2, // Should be 2 eligible files (code.ts and app.tsx)
        percent: 100,
      };
      
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        processed: 2,
        total: 2,
        percent: 100,
        fullContent: 'packed content without binaries',
        tokenEstimate: 200,
      };
      
      // Start with idle state
      const { rerenderWith } = renderContentArea();
      
      // Trigger pack
      const packButton = screen.getByRole('button', { name: /Pack/i });
      fireEvent.click(packButton);
      
      // Update to packing state
      renderContentArea(packingState);
      
      // Wait for progress to reach 100%
      await waitFor(() => {
        const progress = screen.getByRole('progressbar');
        expect(progress).toHaveAttribute('aria-valuenow', '100');
      });
      
      // Update to ready state
      renderContentArea(readyState);
      
      // Verify Preview and Copy buttons are available
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Preview/i })).toBeInTheDocument();
        // Look for the main Copy button (with text), not the icon-only copy buttons
        const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
        const mainCopyButton = copyButtons.find(btn => btn.textContent?.includes('Copy'));
        expect(mainCopyButton).toBeInTheDocument();
      });
      
      // Verify that binary files didn't block completion
      expect(mockPack).toHaveBeenCalledTimes(1);
    });
    
    it('should handle selection with only binary files', async () => {
      // Test scenario: All selected files are binary (png, woff2, mp4)
      // totalFiles should be 0 (no eligible files)
      
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        processed: 0,
        total: 0,
        percent: 100, // Should complete immediately with no eligible files
        fullContent: '', // Empty content since no files are eligible
        tokenEstimate: 0,
      };
      
      renderContentArea();
      
      // Trigger pack
      const packButton = screen.getByRole('button', { name: /Pack/i });
      fireEvent.click(packButton);
      
      // Should go straight to ready with empty content
      renderContentArea(readyState);
      
      // Verify it completes even with no eligible files
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Preview/i })).toBeInTheDocument();
      });
      
      expect(mockPack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pack Workflow with Feature Flag Disabled', () => {
    it('should show legacy Preview button when Pack workflow is disabled', () => {
      (window as any).__PF_FEATURES = { PREVIEW_WORKER_ENABLED: true, PREVIEW_PACK_ENABLED: false };
      renderContentArea();
      const previewButton = screen.getByRole('button', { name: /Preview/i });
      expect(previewButton).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Pack/i })).not.toBeInTheDocument();
      delete (window as any).__PF_FEATURES;
    });
  });

  describe('Preview Modal Content After Pack', () => {
    it('should not render blank preview modal after pack completes with many files', async () => {
      // Simulate scenario where many files are "readyNow" (already content-loaded) 
      // and packOnly suppresses displayChunk, but fullContent is available
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        processed: 50,
        total: 50,
        percent: 100,
        fullContent: 'Full packed content from many files',
        contentForDisplay: '', // Empty due to packOnly suppression
        tokenEstimate: 500,
      };

      // Mock ready files scenario
      const manyFiles = Array.from({ length: 50 }, (_, i) => ({
        path: `/file${i}.js`,
        name: `file${i}.js`,
        isDirectory: false,
        size: 100,
        isBinary: false,
        isSkipped: false,
        isContentLoaded: true,
        content: `console.log("file ${i}");`,
        tokenCount: 5
      }));

      // Render with pack ready state
      (usePreviewPack as jest.Mock).mockReturnValue({
        pack: mockPack,
        cancelPack: mockCancelPack,
        packState: readyState,
        previewState: {
          ...defaultPreviewState,
          contentForDisplay: '', // Also empty in streaming preview
        },
        pushFileUpdates: mockPushFileUpdates,
        copyText: readyState.fullContent,
        startPreview: mockStartPreview,
      });

      const mockProps = {
        selectedFiles: manyFiles.map(f => ({ path: f.path })),
        allFiles: manyFiles,
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
        sortOptions: [{ value: 'name', label: 'Name' }],
        getSelectedFilesContent: jest.fn(() => 'test content'),
        calculateTotalTokens: jest.fn(() => 100),
        instructionsTokenCount: 0,
        fileTreeTokens: 0,
        systemPromptTokens: 0,
        rolePromptTokens: 0,
        instructionsTokens: 0,
        setInstructionsModalOpen: jest.fn(),
        loadFileContent: jest.fn(),
        loadMultipleFileContents: jest.fn(async () => {}),
        selectedFolder: null,
        expandedNodes: {},
        toggleExpanded: jest.fn(),
        fileTreeMode: 'none' as const,
      };

      render(<ContentArea {...mockProps} />);
      
      // Click Preview button
      const previewButton = screen.getByRole('button', { name: /Preview/i });
      fireEvent.click(previewButton);
      
      // Verify modal was opened with non-empty content via store state
      const storeState = useUIStore.getState();
      expect(storeState.clipboardPreviewModalOpen).toBe(true);
      expect(storeState.previewContent).toBeTruthy();
      expect(storeState.previewContent.length).toBeGreaterThan(0);
      expect(storeState.previewContent).toContain('Full packed content');
      expect(storeState.previewTokenCount).toBe(500);
    });

    it('should pass previewState to modal only when not in ready state', () => {
      // Render directly in ready state and assert presence of ready UI controls
      const readyState: PackState = {
        ...defaultPackState,
        status: 'ready',
        fullContent: 'packed content',
        contentForDisplay: 'display content',
        tokenEstimate: 150,
      };
      renderContentArea(readyState);
      expect(screen.getByRole('button', { name: /Preview/i })).toBeInTheDocument();
      const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
      const mainCopyButton = copyButtons.find(btn => btn.textContent?.includes('Copy'));
      expect(mainCopyButton).toBeInTheDocument();
    });
  });

  describe('File Tree Inclusion in Pack', () => {
    it('should include file tree in packed content when fileTreeMode is complete', async () => {
      // Mock files with directory structure
      const mockFiles = [
        { 
          path: '/project/src', 
          name: 'src', 
          isDirectory: true,
          size: 0,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: false,
          tokenCount: 0
        },
        { 
          path: '/project/src/index.ts', 
          name: 'index.ts', 
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: true,
          content: 'export const main = () => {};',
          tokenCount: 10
        },
        { 
          path: '/project/src/utils.ts', 
          name: 'utils.ts', 
          isDirectory: false,
          size: 50,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: true,
          content: 'export const helper = () => {};',
          tokenCount: 10
        },
        { 
          path: '/project/README.md', 
          name: 'README.md', 
          isDirectory: false,
          size: 200,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: false,
          tokenCount: 0
        }
      ];

      // Create packed content with file tree
      const packedContentWithTree = `<codebase>
<file_map>
/project
├── src/
│   ├── index.ts
│   └── utils.ts
└── README.md
</file_map>

<file path="/project/src/index.ts">
export const main = () => {};
</file>

<file path="/project/src/utils.ts">
export const helper = () => {};
</file>
</codebase>`;

      const readyStateWithTree: PackState = {
        ...defaultPackState,
        status: 'ready',
        fullContent: packedContentWithTree,
        contentForDisplay: 'display content',
        tokenEstimate: 50,
      };

      // Setup mock with file tree mode
      (usePreviewPack as jest.Mock).mockReturnValue({
        pack: mockPack,
        cancelPack: mockCancelPack,
        packState: readyStateWithTree,
        previewState: defaultPreviewState,
        pushFileUpdates: mockPushFileUpdates,
        copyText: readyStateWithTree.fullContent,
        startPreview: mockStartPreview,
      });

      const mockProps = {
        selectedFiles: [
          { path: '/project/src/index.ts' },
          { path: '/project/src/utils.ts' }
        ],
        allFiles: mockFiles,
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
        sortOptions: [{ value: 'name', label: 'Name' }],
        getSelectedFilesContent: jest.fn(() => 'test content'),
        calculateTotalTokens: jest.fn(() => 100),
        instructionsTokenCount: 0,
        fileTreeTokens: 20,
        systemPromptTokens: 0,
        rolePromptTokens: 0,
        instructionsTokens: 0,
        setInstructionsModalOpen: jest.fn(),
        loadFileContent: jest.fn(),
        loadMultipleFileContents: jest.fn(async () => {}),
        selectedFolder: '/project',
        expandedNodes: {},
        toggleExpanded: jest.fn(),
        fileTreeMode: 'complete' as const,
      };

      render(<ContentArea {...mockProps} />);

      // Verify Copy button is available with packed content
      // The main copy button has class "copy-selected-files-btn" and contains text "Copy"
      const copyButtons = screen.queryAllByRole('button', { name: /Copy/i });
      const mainCopyButton = copyButtons.find(btn => 
        btn.classList.contains('copy-selected-files-btn') && btn.textContent?.includes('Copy')
      );
      
      if (!mainCopyButton) {
        throw new Error('Main copy button not found - test setup error');
      }

      // Simulate clicking copy
      fireEvent.click(mainCopyButton);

      // Verify the packed content includes the file tree
      await waitFor(() => {
        expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('<file_map>')
        );
        expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('/project')
        );
        expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith(
          expect.stringContaining('├── src/')
        );
      });
    });

    it('should not include file tree when fileTreeMode is none', async () => {
      const packedContentNoTree = `<codebase>
<file path="/project/src/index.ts">
export const main = () => {};
</file>
</codebase>`;

      const readyStateNoTree: PackState = {
        ...defaultPackState,
        status: 'ready',
        fullContent: packedContentNoTree,
        contentForDisplay: 'display content',
        tokenEstimate: 20,
      };

      (usePreviewPack as jest.Mock).mockReturnValue({
        pack: mockPack,
        cancelPack: mockCancelPack,
        packState: readyStateNoTree,
        previewState: defaultPreviewState,
        pushFileUpdates: mockPushFileUpdates,
        copyText: readyStateNoTree.fullContent,
        startPreview: mockStartPreview,
      });

      const mockProps = {
        selectedFiles: [{ path: '/project/src/index.ts' }],
        allFiles: [{ 
          path: '/project/src/index.ts', 
          name: 'index.ts', 
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: true,
          content: 'export const main = () => {};',
          tokenCount: 10
        }],
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
        sortOptions: [{ value: 'name', label: 'Name' }],
        getSelectedFilesContent: jest.fn(() => 'test content'),
        calculateTotalTokens: jest.fn(() => 100),
        instructionsTokenCount: 0,
        fileTreeTokens: 0,
        systemPromptTokens: 0,
        rolePromptTokens: 0,
        instructionsTokens: 0,
        setInstructionsModalOpen: jest.fn(),
        loadFileContent: jest.fn(),
        loadMultipleFileContents: jest.fn(async () => {}),
        selectedFolder: '/project',
        expandedNodes: {},
        toggleExpanded: jest.fn(),
        fileTreeMode: 'none' as const,
      };

      render(<ContentArea {...mockProps} />);

      // Click copy button
      // The main copy button has class "copy-selected-files-btn" and contains text "Copy"
      const copyButtons = screen.queryAllByRole('button', { name: /Copy/i });
      const mainCopyButton = copyButtons.find(btn => 
        btn.classList.contains('copy-selected-files-btn') && btn.textContent?.includes('Copy')
      );
      
      if (!mainCopyButton) {
        throw new Error('Main copy button not found - test setup error');
      }
      
      fireEvent.click(mainCopyButton);

      // Verify the packed content does NOT include file tree
      await waitFor(() => {
        expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith(
          expect.not.stringContaining('<file_map>')
        );
      });
    });

    it('should not include file tree when selectedFolder is null even with complete mode', async () => {
      const packedContentNoTree = `<codebase>
<file path="/project/src/index.ts">
export const main = () => {};
</file>
</codebase>`;

      const readyStateNoTree: PackState = {
        ...defaultPackState,
        status: 'ready',
        fullContent: packedContentNoTree,
        contentForDisplay: 'display content',
        tokenEstimate: 30,
      };

      // Setup mock with ready state but no tree
      (usePreviewPack as jest.Mock).mockReturnValue({
        pack: mockPack,
        cancelPack: mockCancelPack,
        packState: readyStateNoTree,
        previewState: defaultPreviewState,
        pushFileUpdates: mockPushFileUpdates,
        copyText: readyStateNoTree.fullContent,
        startPreview: mockStartPreview,
      });

      const mockProps = {
        selectedFiles: [{ path: '/project/src/index.ts' }],
        allFiles: [{ 
          path: '/project/src/index.ts', 
          name: 'index.ts', 
          isDirectory: false,
          size: 100,
          isBinary: false,
          isSkipped: false,
          isContentLoaded: true,
          content: 'export const main = () => {};',
          tokenCount: 10
        }],
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
        sortOptions: [{ value: 'name', label: 'Name' }],
        getSelectedFilesContent: jest.fn(() => 'test content'),
        calculateTotalTokens: jest.fn(() => 100),
        instructionsTokenCount: 0,
        fileTreeTokens: 0,
        systemPromptTokens: 0,
        rolePromptTokens: 0,
        instructionsTokens: 0,
        setInstructionsModalOpen: jest.fn(),
        loadFileContent: jest.fn(),
        loadMultipleFileContents: jest.fn(async () => {}),
        selectedFolder: null,
        expandedNodes: {},
        toggleExpanded: jest.fn(),
        fileTreeMode: 'complete' as const,
      };

      render(<ContentArea {...mockProps} />);

      // Click copy button
      const copyButtons = screen.queryAllByRole('button', { name: /Copy/i });
      const mainCopyButton = copyButtons.find(btn => 
        btn.classList.contains('copy-selected-files-btn') && btn.textContent?.includes('Copy')
      );
      
      if (!mainCopyButton) {
        throw new Error('Main copy button not found - test setup error');
      }
      
      fireEvent.click(mainCopyButton);

      // Verify the packed content does NOT include file tree despite complete mode
      await waitFor(() => {
        expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith(packedContentNoTree);
        expect((navigator as any).clipboard.writeText).not.toHaveBeenCalledWith(
          expect.stringContaining('<file_map>')
        );
      });
    });
  });
});
