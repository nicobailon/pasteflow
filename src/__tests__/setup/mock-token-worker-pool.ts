/**
 * Mock implementation of TokenWorkerPool for Jest tests
 * This avoids the import.meta.url issue entirely by mocking at the module level
 */

export class MockTokenWorkerPool {
  private isTerminated = false;
  private mockDelay = 10;
  private shouldFail = false;
  constructor(_poolSize?: number) {
    // Poolsize is ignored in mock
  }

  async countTokens(text: string): Promise<number> {
    if (this.isTerminated) {
      throw new Error('Worker pool terminated');
    }

    if (this.shouldFail) {
      throw new Error('Worker pool error');
    }

    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, this.mockDelay));

    // Simple token estimation for tests
    return Math.ceil(text.length / 4);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  // Test helpers
  setMockDelay(delay: number): void {
    this.mockDelay = delay;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  setFallbackToEstimation(fallback: boolean): void {
    this.fallbackToEstimation = fallback;
  }

  getQueueSize(): number {
    return 0; // Mock implementation
  }

  getActiveJobCount(): number {
    return 0; // Mock implementation
  }
}

// Export as default to match the real module
export const TokenWorkerPool = MockTokenWorkerPool;