/**
 * Development-only metrics for tracking token estimation accuracy.
 * All functions are no-ops in production builds.
 */

interface TokenAccuracyMetrics {
  sessionId: string;
  estimatedTokens: number;
  finalTokens: number;
  absoluteDelta: number;
  percentDelta: number;
  fileCount: number;
  selectionMode?: string;
  fileBucket: '1-10' | '11-50' | '51-200' | '200+';
}

// Check environment at runtime to support testing
const isDevelopment = (): boolean => process.env.NODE_ENV !== 'production';

/**
 * Track token estimation accuracy (dev-only)
 * @param metrics - Token accuracy metrics for a completed preview session
 */
export function trackTokenAccuracy(metrics: {
  sessionId: string;
  estimatedTokens: number;
  finalTokens: number;
  fileCount: number;
  selectionMode?: string;
}): void {
  if (!isDevelopment()) return;

  const { estimatedTokens, finalTokens, fileCount } = metrics;
  
  // Calculate accuracy metrics
  const absoluteDelta = Math.abs(finalTokens - estimatedTokens);
  const percentDelta = finalTokens > 0 
    ? Math.round((absoluteDelta / finalTokens) * 100) 
    : 0;

  // Bucket file counts for analysis
  let fileBucket: TokenAccuracyMetrics['fileBucket'];
  if (fileCount <= 10) fileBucket = '1-10';
  else if (fileCount <= 50) fileBucket = '11-50';
  else if (fileCount <= 200) fileBucket = '51-200';
  else fileBucket = '200+';

  const fullMetrics: TokenAccuracyMetrics = {
    ...metrics,
    absoluteDelta,
    percentDelta,
    fileBucket,
  };

  // Log metrics at debug level
  console.debug('[TokenMetrics]', {
    sessionId: fullMetrics.sessionId,
    accuracy: `${100 - percentDelta}%`,
    estimated: estimatedTokens,
    final: finalTokens,
    delta: absoluteDelta,
    fileCount,
    bucket: fileBucket,
    mode: metrics.selectionMode,
  });
}

/**
 * Track preview session start (dev-only)
 */
export function trackPreviewStart(sessionId: string, fileCount: number): void {
  if (!isDevelopment()) return;
  
  console.debug('[TokenMetrics] Preview started', {
    sessionId,
    fileCount,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track preview session cancellation (dev-only)
 */
export function trackPreviewCancel(sessionId: string, reason?: string): void {
  if (!isDevelopment()) return;
  
  console.debug('[TokenMetrics] Preview cancelled', {
    sessionId,
    reason,
    timestamp: new Date().toISOString(),
  });
}