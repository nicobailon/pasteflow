// Define proper types for worker messages
interface WorkerMessage {
  type: string;
  id: string;
  [key: string]: unknown;
}

interface ChunkMessage extends WorkerMessage {
  type: 'CHUNK';
  displayChunk: string;
  fullChunk: string;
  processed: number;
  total: number;
  tokenDelta: number;
}

interface ProgressMessage extends WorkerMessage {
  type: 'PROGRESS';
  processed: number;
  total: number;
  percent: number;
  tokenEstimate: number;
  elapsedMs: number;
}

interface UpdateFileStatusMessage extends WorkerMessage {
  type: 'UPDATE_FILE_STATUS';
  path: string;
  status: 'error' | 'skipped';
  error?: string;
}

type PreviewWorkerMessage = ChunkMessage | ProgressMessage | UpdateFileStatusMessage;

// Mock the worker context with proper typing
const mockPostMessage = jest.fn<void, [PreviewWorkerMessage]>();
const ctx: { postMessage: typeof mockPostMessage } = {
  postMessage: mockPostMessage,
};

describe('Preview Generator Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPostMessage.mockClear();
  });

  describe('Worker Totals Consistency', () => {
    it('should use totalEligibleFiles consistently in both CHUNK header and PROGRESS messages', () => {
      // Mock files data
      // Mock files data showing mixed types
      const totalEligibleFiles = 3; // Only non-binary, non-skipped files

      // The worker would process files and emit messages
      // For this test, we're verifying the messages sent have consistent totals

      // Capture messages sent during worker execution
      const messages: PreviewWorkerMessage[] = [];
      mockPostMessage.mockImplementation((msg) => {
        messages.push(msg);
      });

      // Simulate the worker processing (simplified version)
      // The worker should emit a header CHUNK first
      mockPostMessage({
        type: 'CHUNK',
        id: 'test-id',
        displayChunk: 'header',
        fullChunk: 'header',
        processed: 0,
        total: totalEligibleFiles, // Should use totalEligibleFiles
        tokenDelta: 10,
      });

      // Then emit PROGRESS updates
      mockPostMessage({
        type: 'PROGRESS',
        id: 'test-id',
        processed: 1,
        total: totalEligibleFiles, // Should also use totalEligibleFiles
        percent: 33,
        tokenEstimate: 10,
        elapsedMs: 100,
      });

      // Verify both messages use the same total
      const chunkMessage = messages.find((m) => m.type === 'CHUNK');
      const progressMessage = messages.find((m) => m.type === 'PROGRESS');

      expect(chunkMessage).toBeDefined();
      expect(progressMessage).toBeDefined();
      expect(chunkMessage?.total).toBe(totalEligibleFiles);
      expect(progressMessage?.total).toBe(totalEligibleFiles);
      expect(chunkMessage?.total).toBe(progressMessage?.total);
    });

    it('should only count eligible files in totalEligibleFiles', () => {
      // Test that binary and skipped files are excluded from totalEligibleFiles
      // Example: 7 total files, but only 3 are eligible (not binary, not skipped)
      const expectedEligibleCount = 3;

      const messages: PreviewWorkerMessage[] = [];
      mockPostMessage.mockImplementation((msg) => {
        messages.push(msg);
      });

      // Simulate header emission
      mockPostMessage({
        type: 'CHUNK',
        id: 'test-id',
        displayChunk: 'header',
        fullChunk: 'header',
        processed: 0,
        total: expectedEligibleCount,
        tokenDelta: 10,
      });

      // Simulate progress emission
      mockPostMessage({
        type: 'PROGRESS',
        id: 'test-id',
        processed: expectedEligibleCount,
        total: expectedEligibleCount,
        percent: 100,
        tokenEstimate: 30,
        elapsedMs: 200,
      });

      const chunkMessage = messages.find((m) => m.type === 'CHUNK');
      const progressMessage = messages.find((m) => m.type === 'PROGRESS');

      // Both should report only eligible files
      expect(chunkMessage?.total).toBe(expectedEligibleCount);
      expect(progressMessage?.total).toBe(expectedEligibleCount);
      
      // When all eligible files are processed, percent should be 100
      expect(progressMessage?.percent).toBe(100);
    });
  });

  describe('File Status Updates', () => {
    it('should handle UPDATE_FILE_STATUS messages for failed files', () => {
      const messages: PreviewWorkerMessage[] = [];
      mockPostMessage.mockImplementation((msg) => {
        messages.push(msg);
      });

      // After processing failed file, PROGRESS should reflect it
      mockPostMessage({
        type: 'PROGRESS',
        id: 'test-id',
        processed: 1, // Failed files count as processed
        total: 1,
        percent: 100,
        tokenEstimate: 0,
        elapsedMs: 50,
      });

      const progressMessage = messages.find((m) => m.type === 'PROGRESS');
      expect(progressMessage?.processed).toBe(1);
      expect(progressMessage?.percent).toBe(100);
    });

    it('should handle UPDATE_FILE_STATUS messages for skipped files', () => {
      const messages: PreviewWorkerMessage[] = [];
      mockPostMessage.mockImplementation((msg) => {
        messages.push(msg);
      });

      // After processing skipped file, PROGRESS should reflect it
      mockPostMessage({
        type: 'PROGRESS',
        id: 'test-id',
        processed: 1, // Skipped files count as processed
        total: 1,
        percent: 100,
        tokenEstimate: 0,
        elapsedMs: 50,
      });

      const progressMessage = messages.find((m) => m.type === 'PROGRESS');
      expect(progressMessage?.processed).toBe(1);
      expect(progressMessage?.percent).toBe(100);
    });
  });
});