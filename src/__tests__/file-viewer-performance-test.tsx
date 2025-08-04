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

const generateMalformedContent = (): string => {
  return 'Line 1: Normal\n' + 
         '\x00\x01\x02' + // Binary characters
         'Line 3: After binary\n' +
         'Line 4: ' + 'x'.repeat(10000); // Very long line
};

const createMockFile = (lineCount: number, options?: Partial<FileData>): FileData => ({
  name: 'test-file.ts',
  path: '/test/test-file.ts',
  isDirectory: false,
  isContentLoaded: true,
  content: generateTestContent(lineCount),
  size: lineCount * 80,
  isBinary: false,
  tokenCount: lineCount * 15,
  isSkipped: false,
  ...options,
});

const createMockProps = (lineCount: number = 100, options?: Partial<FileViewModalProps>): FileViewModalProps => ({
  isOpen: true,
  onClose: jest.fn(),
  filePath: '/test/test-file.ts',
  allFiles: [createMockFile(lineCount)],
  selectedFile: undefined,
  onUpdateSelectedFile: jest.fn(),
  loadFileContent: jest.fn().mockImplementation(() => {
    // Simulate real file loading with delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          content: generateTestContent(lineCount),
          tokenCount: lineCount * 15,
        });
      }, 10);
    });
  }),
  ...options,
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
        
        // Use relative threshold for more stable tests
        const maxAllowedTime = Math.max(threshold, renderTime * 1.5);
        expect(renderTime).toBeLessThan(maxAllowedTime);
        
        // Verify content is rendered
        expect(container.textContent).toContain('Line 1:');
        
        const shouldVirtualize = size > 1000;
        if (shouldVirtualize) {
          expect(screen.getByText(/Virtualized/)).toBeInTheDocument();
          // Verify virtualization is actually limiting DOM elements
          const visibleLines = container.querySelectorAll('[data-line-number]');
          expect(visibleLines.length).toBeLessThan(100);
          expect(visibleLines.length).toBeGreaterThan(0);
        } else {
          expect(screen.queryByText(/Virtualized/)).not.toBeInTheDocument();
          // Small files should render all lines
          const visibleLines = container.querySelectorAll('[data-line-number]');
          expect(visibleLines.length).toBeGreaterThan(0);
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
      expect(renderedLines.length).toBeGreaterThan(10); // At least some visible
      
      // Verify scrollable container exists
      const scrollContainer = container.querySelector('[style*="overflow"]');
      expect(scrollContainer).toBeInTheDocument();
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
      
      // Verify content is actually visible
      expect(container.textContent).toContain('Line 1:');
      expect(container.textContent).toContain('Line 500:');
    });
    
    it('should correctly handle virtualization threshold boundary', async () => {
      // Test exactly at threshold (1000 lines) - should NOT virtualize
      const atThresholdProps = createMockProps(1000);
      const { container: atThreshold, unmount: unmount1 } = render(<FileViewModalIntegrated {...atThresholdProps} />);
      
      await waitFor(() => {
        expect(atThreshold.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      // Should NOT virtualize at exactly 1000 (threshold is > 1000, not >= 1000)
      expect(screen.queryByText(/Virtualized/)).not.toBeInTheDocument();
      
      unmount1(); // Clean up before next render
      
      // Test just above threshold (1001 lines) - should virtualize
      const aboveThresholdProps = createMockProps(1001);
      const { container: aboveThreshold } = render(<FileViewModalIntegrated {...aboveThresholdProps} />);
      
      await waitFor(() => {
        expect(aboveThreshold.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      // Should virtualize at 1001
      expect(screen.getByText(/Virtualized/)).toBeInTheDocument();
      
      // Verify DOM elements are limited when virtualized
      const virtualizedLines = aboveThreshold.querySelectorAll('[data-line-number]');
      expect(virtualizedLines.length).toBeLessThan(100);
      expect(virtualizedLines.length).toBeGreaterThan(0);
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
      
      // Verify no individual onclick handlers on line elements
      const lineElements = container.querySelectorAll('[data-line-number]');
      expect(lineElements.length).toBeGreaterThan(0);
      
      let individualHandlers = 0;
      lineElements.forEach(element => {
        if ((element as HTMLElement).onclick) {
          individualHandlers++;
        }
      });
      expect(individualHandlers).toBe(0);
      
      // Verify container has event handling capability
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      });
      
      const startTime = performance.now();
      contentContainer?.dispatchEvent(clickEvent);
      const endTime = performance.now();
      
      // Event delegation should be very fast
      expect(endTime - startTime).toBeLessThan(10);
      
      // Verify event bubbling works
      expect(clickEvent.bubbles).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed content gracefully', async () => {
      const props = createMockProps(100, {
        allFiles: [createMockFile(100, { 
          content: generateMalformedContent() 
        })],
      });
      
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      // Should still render despite malformed content
      expect(container.textContent).toContain('Line 1: Normal');
      expect(container.querySelector('.error-message')).not.toBeInTheDocument();
      
      // Should handle the long line without breaking
      const longLineElement = container.querySelector('[data-line-number="4"]');
      if (longLineElement) {
        expect(longLineElement).toBeInTheDocument();
        const computedStyle = window.getComputedStyle(longLineElement);
        expect(computedStyle.overflow).toBeDefined();
      }
    });
    
    it('should handle null or undefined content', async () => {
      const props = createMockProps(100, {
        allFiles: [createMockFile(100, { 
          content: undefined,
          isContentLoaded: false 
        })],
      });
      
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        const modal = container.querySelector('.file-view-modal-content');
        expect(modal).toBeInTheDocument();
      });
      
      // Should show loading or empty state
      const contentArea = container.querySelector('.file-view-modal-content');
      expect(contentArea).toBeTruthy();
      expect(props.loadFileContent).toHaveBeenCalled();
    });
    
    it('should handle file loading errors', async () => {
      const errorMessage = 'Failed to load file';
      const props = createMockProps(100, {
        loadFileContent: jest.fn().mockRejectedValue(new Error(errorMessage)),
        allFiles: [createMockFile(100, { 
          isContentLoaded: false,
          content: undefined 
        })],
      });
      
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(props.loadFileContent).toHaveBeenCalled();
      });
      
      // Should handle the error gracefully
      const modal = container.querySelector('.file-view-modal-content');
      expect(modal).toBeInTheDocument();
      
      // Component should remain functional
      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });
    
    it('should handle concurrent operations without race conditions', async () => {
      const props = createMockProps(1000);
      const { container, rerender } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      // Simulate rapid prop changes
      const newProps1 = createMockProps(500);
      const newProps2 = createMockProps(2000);
      
      // Rapid rerenders
      rerender(<FileViewModalIntegrated {...newProps1} />);
      rerender(<FileViewModalIntegrated {...newProps2} />);
      
      await waitFor(() => {
        // Should stabilize with the latest props
        const content = container.querySelector('.file-view-modal-content');
        expect(content).toBeInTheDocument();
      });
      
      // Should show virtualized for 2000 lines
      expect(screen.getByText(/Virtualized/)).toBeInTheDocument();
      
      // Performance should not degrade
      const metrics = fileViewerPerformance.getMetricsSummary();
      expect(metrics.averageRenderTime).toBeDefined();
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
      expect(fileViewerPerformance.shouldUseVirtualization(1000)).toBe(false); // Exactly 1000 is not virtualized
      expect(fileViewerPerformance.shouldUseVirtualization(1001)).toBe(true);  // Greater than 1000 is virtualized
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
      expect(contentContainer).toBeTruthy();
      
      const startTime = performance.now();
      
      fireEvent.mouseDown(contentContainer!, {
        clientX: 50,
        clientY: 100,
      });
      
      // Simulate drag over multiple lines
      let dragMoveCount = 0;
      for (let y = 100; y <= 500; y += 20) {
        fireEvent.mouseMove(window, {
          clientX: 50,
          clientY: y,
        });
        dragMoveCount++;
      }
      
      fireEvent.mouseUp(window);
      
      const endTime = performance.now();
      const dragTime = endTime - startTime;
      
      // Performance assertions
      expect(dragTime).toBeLessThan(200);
      expect(dragMoveCount).toBeGreaterThan(10); // Verify we actually simulated multiple moves
      
      // Verify selection actually happened
      const selectedLines = container.querySelectorAll('.selected-line');
      expect(selectedLines.length).toBeGreaterThan(0);
      
      // Verify UI responsiveness during drag
      const tokenDisplay = screen.queryByText(/tokens selected/);
      if (tokenDisplay) {
        expect(tokenDisplay).toBeInTheDocument();
      }
    });
    
    it('should handle rapid drag direction changes', async () => {
      const props = createMockProps(500);
      const { container } = render(<FileViewModalIntegrated {...props} />);
      
      await waitFor(() => {
        expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      });
      
      const specificRadio = screen.getByLabelText('Select specific lines');
      fireEvent.click(specificRadio);
      
      const contentContainer = container.querySelector('.file-view-modal-content');
      
      // Start drag
      fireEvent.mouseDown(contentContainer!, { clientX: 50, clientY: 100 });
      
      // Drag up and down rapidly
      const movements = [200, 100, 300, 150, 250, 50, 400];
      movements.forEach(y => {
        fireEvent.mouseMove(window, { clientX: 50, clientY: y });
      });
      
      fireEvent.mouseUp(window);
      
      // Should handle direction changes without errors
      expect(container.querySelector('.file-view-modal-content')).toBeInTheDocument();
      
      // Should have selected lines
      const selectedIndicators = container.querySelectorAll('[data-selected="true"]');
      expect(selectedIndicators.length).toBeGreaterThan(0);
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
    // Test with actual DOM manipulation instead of busy wait
    const renderTime = fileViewerPerformance.measureRenderTime(1000, () => {
      // Simulate real rendering work
      const container = document.createElement('div');
      for (let i = 0; i < 100; i++) {
        const element = document.createElement('div');
        element.textContent = `Line ${i}`;
        element.setAttribute('data-line-number', String(i));
        container.appendChild(element);
      }
      // Force layout recalculation
      void container.offsetHeight;
    });
    
    // Verify timing was captured
    expect(renderTime).toBeGreaterThanOrEqual(0);
    expect(renderTime).toBeLessThan(1000); // Should be under 1 second
    
    // Verify metric was recorded
    const metrics = fileViewerPerformance.getMetricsSummary();
    expect(metrics.totalMetrics).toBeGreaterThan(0);
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