import { resolveWorkerUrl, withTimeout } from '../../worker-base/worker-common';

describe('worker-common', () => {
  describe('resolveWorkerUrl', () => {
    it('should return mock path in jest environment', () => {
      const result = resolveWorkerUrl('../workers/test-worker.ts');
      expect(result).toBe('/mock/worker/path');
    });
  });

  describe('withTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await withTimeout(promise, 1000, 'test');
      expect(result).toBe('success');
    });

    it('should reject when promise times out', async () => {
      const promise = new Promise(() => {}); // Never resolves
      await expect(withTimeout(promise, 10, 'test')).rejects.toThrow('test timeout after 10ms');
    });

    it('should clear timeout when promise resolves', async () => {
      jest.useFakeTimers();
      const promise = Promise.resolve('success');
      const resultPromise = withTimeout(promise, 1000, 'test');
      
      await Promise.resolve(); // Let promise resolve
      jest.runAllTimers();
      
      const result = await resultPromise;
      expect(result).toBe('success');
      jest.useRealTimers();
    });

    it('should clear timeout when promise rejects', async () => {
      const error = new Error('test error');
      const promise = Promise.reject(error);
      await expect(withTimeout(promise, 1000, 'test')).rejects.toThrow('test error');
    });
  });
});