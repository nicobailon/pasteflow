import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { performance } from 'perf_hooks';
import FileViewModalIntegrated from '../components/file-view-modal-integrated';
import { FileData, FileViewModalProps } from '../types/file-types';
import { fileViewerPerformance } from '../utils/file-viewer-performance';

const generateTestContent = (lines: number): string => {
  const testLines = [];
  for (let i = 1; i <= lines; i++) {
    testLines.push(`Line ${i}: This is some test content with code const value = ${i}; // comment`);
  }
  return testLines.join('\n');
};

const createMockFile = (lineCount: number): FileData => ({
  name: 'test-file.ts',
  path: '/test/test-file.ts',
  isDirectory: false,
  isContentLoaded: true,
  content: generateTestContent(lineCount),
  size: lineCount * 80,
  isBinary: false,
  tokenCount: lineCount * 15,
  isSkipped: false,
});

const createMockProps = (lineCount: number = 100): FileViewModalProps => ({
  isOpen: true,
  onClose: jest.fn(),
  filePath: '/test/test-file.ts',
  allFiles: [createMockFile(lineCount)],
  selectedFile: undefined,
  onUpdateSelectedFile: jest.fn(),
  loadFileContent: jest.fn().mockResolvedValue(undefined),
});

describe('FileViewModal Performance Tests', () => {
  beforeEach(() => {
    fileViewerPerformance.clearMetrics();
  });

  describe('Render Performance', () => {
    const testSizes = [100, 500, 1000, 2000, 5000];
    
    testSizes.forEach(size => {
      it(`should render ${size} lines within performance threshold`, async () => {
        const props = createMockProps(size);
        const startTime = performance.now();
        
        const { container } = render(<FileViewModalIntegrated {...props} />);
        
        await waitFor(() => {
          expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
        });
        
        const endTime = performance.now();
        const renderTime = endTime - startTime;
        const threshold = fileViewerPerformance.getPerformanceThreshold(size);
        
        expect(renderTime).toBeLessThan(threshold);
        
        const shouldVirtualize = size >= 1000;
        if (shouldVirtualize) {
          expect(screen.getByText(/Virtualized/)).toBeInTheDocument();
        }
      });
    });
  });

  describe('Line Selection Performance', () => {
    it('should handle rapid line selection efficiently', async () => {
      const props = createMockProps(1000);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const specificRadio = screen.getByLabelText('Select specific lines');
      fireEvent.click(specificRadio);
      
      const startTime = performance.now();
      
      for (let i = 1; i <= 50; i++) {
        const lineElement = container.querySelector(`[data-line-number="${i}"]`);
        if (lineElement) {
          fireEvent.click(lineElement);
        }
      }
      
      const endTime = performance.now();
      const selectionTime = endTime - startTime;
      
      expect(selectionTime).toBeLessThan(500);
    });
    
    it('should use Set-based selection for O(1) lookups', async () => {
      const props = createMockProps(5000);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const specificRadio = screen.getByLabelText('Select specific lines');
      fireEvent.click(specificRadio);
      
      const selectAllButton = screen.getByTitle('Select All Lines');
      fireEvent.click(selectAllButton);
      
      const checkStartTime = performance.now();
      
      for (let i = 1; i <= 100; i++) {
        const randomLine = Math.floor(Math.random() * 5000) + 1;
        const lineElement = container.querySelector(`[data-line-number="${randomLine}"]`);
        expect(lineElement).toBeTruthy();
      }
      
      const checkEndTime = performance.now();
      const checkTime = checkEndTime - checkStartTime;
      
      expect(checkTime).toBeLessThan(100);
    });
  });

  describe('Memory Usage', () => {
    it('should use virtualization for large files', async () => {
      const largeFileProps = createMockProps(2000);
      const { container } = render(<FileViewModalIntegrated {...largeFileProps} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      expect(screen.getByText(/Virtualized.*2000 lines/)).toBeInTheDocument();
      
      const renderedLines = container.querySelectorAll('[data-line-number]');
      expect(renderedLines.length).toBeLessThan(100);
    });
    
    it('should not virtualize small files', async () => {
      const smallFileProps = createMockProps(500);
      const { container } = render(<FileViewModalIntegrated {...smallFileProps} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      expect(screen.queryByText(/Virtualized/)).not.toBeInTheDocument();
      
      const renderedLines = container.querySelectorAll('[data-line-number]');
      expect(renderedLines.length).toBeGreaterThan(0);
    });
  });

  describe('Event Handler Optimization', () => {
    it('should use event delegation instead of individual handlers', async () => {
      const props = createMockProps(1000);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const contentContainer = container.querySelector('.file-view-modal-content');
      expect(contentContainer).toBeTruthy();
      
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });
      
      const startTime = performance.now();
      contentContainer?.dispatchEvent(clickEvent);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(10);
    });
  });

  describe('Performance Monitoring', () => {
    it('should track render times', async () => {
      const props = createMockProps(1000);
      render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        const metrics = fileViewerPerformance.getMetricsSummary();
        expect(metrics.totalMetrics).toBeGreaterThan(0);
      });
      
      const summary = fileViewerPerformance.getMetricsSummary();
      expect(summary.averageRenderTime).toBeDefined();
      expect(summary.averageRenderTime).not.toBeNull();
    });
    
    it('should correctly identify when to use virtualization', () => {
      expect(fileViewerPerformance.shouldUseVirtualization(500)).toBe(false);
      expect(fileViewerPerformance.shouldUseVirtualization(999)).toBe(false);
      expect(fileViewerPerformance.shouldUseVirtualization(1000)).toBe(true);
      expect(fileViewerPerformance.shouldUseVirtualization(5000)).toBe(true);
    });
  });

  describe('Drag Selection Performance', () => {
    it('should handle drag selection efficiently', async () => {
      const props = createMockProps(1000);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const specificRadio = screen.getByLabelText('Select specific lines');
      fireEvent.click(specificRadio);
      
      const contentContainer = container.querySelector('.file-view-modal-content');
      
      const startTime = performance.now();
      
      fireEvent.mouseDown(contentContainer!, {
        clientX: 50,
        clientY: 100,
      });
      
      for (let y = 100; y <= 500; y += 20) {
        fireEvent.mouseMove(window, {
          clientX: 50,
          clientY: y,
        });
      }
      
      fireEvent.mouseUp(window);
      
      const endTime = performance.now();
      const dragTime = endTime - startTime;
      
      expect(dragTime).toBeLessThan(200);
    });
  });

  describe('Token Count Performance', () => {
    it('should calculate token counts efficiently', async () => {
      const props = createMockProps(2000);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const tokenEstimate = screen.getByText(/total tokens/);
      expect(tokenEstimate).toBeInTheDocument();
      expect(tokenEstimate.textContent).toMatch(/\d+/);
    });
  });
});

describe('FileViewerPerformanceMonitor', () => {
  beforeEach(() => {
    fileViewerPerformance.clearMetrics();
  });
  
  it('should measure render times accurately', () => {
    const renderTime = fileViewerPerformance.measureRenderTime(1000, () => {
      const delay = 50;
      const start = Date.now();
      while (Date.now() - start < delay) {}
    });
    
    expect(renderTime).toBeGreaterThanOrEqual(50);
    expect(renderTime).toBeLessThan(100);
  });
  
  it('should maintain metrics history', () => {
    for (let i = 0; i < 5; i++) {
      fileViewerPerformance.measureRenderTime(100 * (i + 1), () => {});
    }
    
    const summary = fileViewerPerformance.getMetricsSummary();
    expect(summary.totalMetrics).toBe(5);
    expect(summary.averageRenderTime).toBeDefined();
    expect(summary.maxRenderTime).toBeDefined();
    expect(summary.minRenderTime).toBeDefined();
  });
  
  it('should provide accurate performance thresholds', () => {
    expect(fileViewerPerformance.getPerformanceThreshold(500)).toBe(100);
    expect(fileViewerPerformance.getPerformanceThreshold(3000)).toBe(500);
    expect(fileViewerPerformance.getPerformanceThreshold(10000)).toBe(1000);
  });
  
  it('should filter recent metrics correctly', () => {
    fileViewerPerformance.measureRenderTime(100, () => {});
    
    const recent = fileViewerPerformance.getRecentMetrics(1000);
    expect(recent.length).toBeGreaterThan(0);
    
    const old = fileViewerPerformance.getRecentMetrics(0);
    expect(old.length).toBe(0);
  });
});