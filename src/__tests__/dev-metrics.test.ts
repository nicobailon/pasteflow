/**
 * Tests for development-only metrics tracking
 */

import { trackTokenAccuracy, trackPreviewStart, trackPreviewCancel } from '../utils/dev-metrics';

describe('Dev Metrics', () => {
  let originalEnv: string | undefined;
  let consoleDebugSpy: jest.SpyInstance<void, [message?: unknown, ...optionalParams: unknown[]]>;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    consoleDebugSpy.mockRestore();
  });

  describe('trackTokenAccuracy', () => {
    it('should log metrics in development environment', () => {
      process.env.NODE_ENV = 'development';
      
      trackTokenAccuracy({
        sessionId: 'test-session-123',
        estimatedTokens: 1000,
        finalTokens: 1100,
        fileCount: 25,
        selectionMode: 'selected',
      });

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[TokenMetrics]',
        expect.objectContaining({
          sessionId: 'test-session-123',
          accuracy: '91%',
          estimated: 1000,
          final: 1100,
          delta: 100,
          fileCount: 25,
          bucket: '11-50',
          mode: 'selected',
        })
      );
    });

    it('should not log metrics in production environment', () => {
      process.env.NODE_ENV = 'production';
      
      trackTokenAccuracy({
        sessionId: 'test-session-123',
        estimatedTokens: 1000,
        finalTokens: 1100,
        fileCount: 25,
      });

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      
      // Verify multiple calls in production still don't log
      trackTokenAccuracy({
        sessionId: 'test-session-456',
        estimatedTokens: 2000,
        finalTokens: 2200,
        fileCount: 50,
      });
      
      trackTokenAccuracy({
        sessionId: 'test-session-789',
        estimatedTokens: 3000,
        finalTokens: 3300,
        fileCount: 100,
      });
      
      expect(consoleDebugSpy).toHaveBeenCalledTimes(0);
    });

    it('should categorize file counts into correct buckets', () => {
      process.env.NODE_ENV = 'development';
      
      const testCases = [
        { fileCount: 5, expectedBucket: '1-10' },
        { fileCount: 10, expectedBucket: '1-10' },
        { fileCount: 11, expectedBucket: '11-50' },
        { fileCount: 50, expectedBucket: '11-50' },
        { fileCount: 51, expectedBucket: '51-200' },
        { fileCount: 200, expectedBucket: '51-200' },
        { fileCount: 201, expectedBucket: '200+' },
        { fileCount: 1000, expectedBucket: '200+' },
      ];

      testCases.forEach(({ fileCount, expectedBucket }) => {
        consoleDebugSpy.mockClear();
        
        trackTokenAccuracy({
          sessionId: `test-${fileCount}`,
          estimatedTokens: 1000,
          finalTokens: 1000,
          fileCount,
        });

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          '[TokenMetrics]',
          expect.objectContaining({
            bucket: expectedBucket,
            fileCount,
          })
        );
      });
    });

    it('should calculate accuracy percentage correctly', () => {
      process.env.NODE_ENV = 'development';
      
      const testCases = [
        { estimated: 900, final: 1000, expectedAccuracy: '90%' },
        { estimated: 1100, final: 1000, expectedAccuracy: '90%' },
        { estimated: 1000, final: 1000, expectedAccuracy: '100%' },
        { estimated: 500, final: 1000, expectedAccuracy: '50%' },
      ];

      testCases.forEach(({ estimated, final, expectedAccuracy }) => {
        consoleDebugSpy.mockClear();
        
        trackTokenAccuracy({
          sessionId: 'test-accuracy',
          estimatedTokens: estimated,
          finalTokens: final,
          fileCount: 10,
        });

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          '[TokenMetrics]',
          expect.objectContaining({
            accuracy: expectedAccuracy,
            estimated,
            final,
          })
        );
      });
    });
  });

  describe('trackPreviewStart', () => {
    it('should log preview start in development', () => {
      process.env.NODE_ENV = 'development';
      
      trackPreviewStart('session-456', 15);

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[TokenMetrics] Preview started',
        expect.objectContaining({
          sessionId: 'session-456',
          fileCount: 15,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        })
      );
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    });

    it('should not log in production', () => {
      process.env.NODE_ENV = 'production';
      
      trackPreviewStart('session-456', 15);

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe('trackPreviewCancel', () => {
    it('should log preview cancellation in development', () => {
      process.env.NODE_ENV = 'development';
      
      trackPreviewCancel('session-789', 'User cancelled');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[TokenMetrics] Preview cancelled',
        expect.objectContaining({
          sessionId: 'session-789',
          reason: 'User cancelled',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        })
      );
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    });

    it('should log without reason if not provided', () => {
      process.env.NODE_ENV = 'development';
      
      trackPreviewCancel('session-789');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[TokenMetrics] Preview cancelled',
        expect.objectContaining({
          sessionId: 'session-789',
          reason: undefined,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        })
      );
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    });

    it('should not log in production', () => {
      process.env.NODE_ENV = 'production';
      
      trackPreviewCancel('session-789', 'User cancelled');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });
});