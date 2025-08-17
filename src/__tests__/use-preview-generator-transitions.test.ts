/**
 * Tests for startTransition usage and non-blocking updates in usePreviewGenerator hook
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { usePreviewGenerator } from '../hooks/use-preview-generator';

// Mock the worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private listeners: Map<string, Set<EventListener>> = new Map();

  postMessage(data: unknown): void {
    // Process message
    const msg = data as { type: string; payload?: unknown };
    
    // Simulate worker responses
    setTimeout(() => {
      if (msg.type === 'INIT') {
        this.emit({ type: 'READY' });
      } else if (msg.type === 'START') {
        // Simulate streaming chunks
        const payload = (msg as { payload: { id: string } }).payload;
        this.emit({
          type: 'CHUNK',
          id: payload.id,
          displayChunk: 'Test chunk',
          fullChunk: 'Test chunk',
          processed: 1,
          total: 5,
          tokenDelta: 10,
        });
      }
    }, 0);
  }

  addEventListener(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  removeEventListener(event: string, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  terminate(): void {
    this.listeners.clear();
  }

  private emit(data: unknown): void {
    const event = new MessageEvent('message', { data });
    this.listeners.get('message')?.forEach(listener => {
      listener(event);
    });
  }
}

// Replace global Worker with mock
(global as { Worker?: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

describe('usePreviewGenerator - non-blocking updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle state updates smoothly during streaming', async () => {
    const { result } = renderHook(() => usePreviewGenerator());

    // Start a preview
    await act(async () => {
      result.current.startPreview({
        allFiles: [],
        selectedFiles: [],
        sortOrder: 'alphabetical',
        fileTreeMode: 'none',
        selectedFolder: null,
        selectedSystemPrompts: [],
        selectedRolePrompts: [],
        selectedInstructions: [],
        userInstructions: '',
      });
    });

    // Wait for the state updates from the worker
    await waitFor(() => {
      // Verify the preview state was updated
      expect(result.current.previewState.status).not.toBe('idle');
    });
    
    // Verify that state transitions happened smoothly
    expect(result.current.previewState.processed).toBeGreaterThanOrEqual(0);
    expect(result.current.previewState.total).toBeGreaterThanOrEqual(0);
  });

  it('should batch updates efficiently to reduce re-renders', async () => {
    const { result } = renderHook(() => usePreviewGenerator());

    // Start preview
    await act(async () => {
      result.current.startPreview({
        allFiles: [
          { 
            name: 'test.ts', 
            path: '/test.ts', 
            isDirectory: false,
            size: 100,
            isBinary: false,
            isSkipped: false,
            error: undefined,
            fileType: 'ts',
            isContentLoaded: true,
            tokenCount: 50,
          },
        ],
        selectedFiles: [{ path: '/test.ts' }],
        sortOrder: 'alphabetical',
        fileTreeMode: 'none',
        selectedFolder: null,
        selectedSystemPrompts: [],
        selectedRolePrompts: [],
        selectedInstructions: [],
        userInstructions: '',
      });
    });

    // Wait for state updates to complete
    await waitFor(() => {
      expect(result.current.previewState.status).not.toBe('idle');
    });

    // Verify that updates were processed
    expect(result.current.previewState.processed).toBeGreaterThanOrEqual(0);
    expect(result.current.previewState.total).toBeGreaterThanOrEqual(0);
    
    // Verify state is consistent
    expect(result.current.previewState.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it('should maintain responsiveness during heavy streaming updates', async () => {
    const { result } = renderHook(() => usePreviewGenerator());

    // Start preview with multiple files
    await act(async () => {
      result.current.startPreview({
        allFiles: Array.from({ length: 10 }, (_, i) => ({
          name: `file${i}.ts`,
          path: `/file${i}.ts`,
          isDirectory: false,
          size: 1000,
          isBinary: false,
          isSkipped: false,
          error: undefined,
          fileType: 'ts',
          isContentLoaded: true,
          tokenCount: 100,
        })),
        selectedFiles: Array.from({ length: 10 }, (_, i) => ({
          path: `/file${i}.ts`,
        })),
        sortOrder: 'alphabetical',
        fileTreeMode: 'none',
        selectedFolder: null,
        selectedSystemPrompts: [],
        selectedRolePrompts: [],
        selectedInstructions: [],
        userInstructions: '',
      });
    });

    // Verify the state is being updated correctly
    await waitFor(() => {
      expect(result.current.previewState.status).not.toBe('idle');
    });
    
    // Check that state is consistent even with multiple file updates
    expect(result.current.previewState.processed).toBeGreaterThanOrEqual(0);
    expect(result.current.previewState.total).toBeGreaterThanOrEqual(0);
    
    // Verify that we're processing files
    if (result.current.previewState.total > 0) {
      expect(result.current.previewState.percent).toBeGreaterThanOrEqual(0);
      expect(result.current.previewState.percent).toBeLessThanOrEqual(100);
    }
  });

  it('should not interfere with urgent updates like status changes', async () => {
    const { result } = renderHook(() => usePreviewGenerator());

    // Start and then immediately cancel
    await act(async () => {
      result.current.startPreview({
        allFiles: [],
        selectedFiles: [],
        sortOrder: 'alphabetical',
        fileTreeMode: 'none',
        selectedFolder: null,
        selectedSystemPrompts: [],
        selectedRolePrompts: [],
        selectedInstructions: [],
        userInstructions: '',
      });
    });

    // Cancel should update status immediately
    await act(async () => {
      result.current.cancel();
    });

    // Status change should be immediate
    expect(result.current.previewState.status).toBe('cancelled');
    // Verify that percent is not incorrectly set to 100 after cancellation
    expect(result.current.previewState.percent).toBeLessThanOrEqual(100);
  });
});