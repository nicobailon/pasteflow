# Web Worker Integration for Token Counting

## Quick Start

To enable the Web Worker feature in PasteFlow:
1. Press `Cmd+Shift+D` (Mac) or `Ctrl+Shift+D` (Windows/Linux)
2. Toggle "Web Worker Token Counting" to ON
3. The app will reload with the feature enabled

For detailed instructions, see [Enabling Web Worker Feature](./enabling-web-worker-feature.md).

## Overview

This document describes the integration of Web Worker-based token counting into PasteFlow, which moves the computationally intensive token counting operations from the main thread to background workers, preventing UI freezing during large file processing.

## Architecture

### Components

1. **Token Counter Worker** (`src/workers/token-counter-worker.ts`)
   - Runs tiktoken/lite in a Web Worker
   - Handles text sanitization and token counting
   - Implements 10MB file size limit for security
   - Falls back to character-based estimation on errors

2. **Worker Pool Manager** (`src/utils/token-worker-pool.ts`)
   - Manages 2-8 workers dynamically based on hardware
   - Implements job queue with FIFO processing
   - Monitors performance and memory usage
   - Automatically recycles workers at 500MB threshold

3. **React Hook** (`src/hooks/use-token-counter.ts`)
   - Provides simple interface for components
   - Handles worker pool initialization
   - Manages cleanup on unmount
   - Provides performance statistics

4. **Feature Flag System** (`src/utils/feature-flags.ts`)
   - Controls gradual rollout
   - Checks URL params, localStorage, and remote config
   - Defaults to disabled for safety
   - Allows runtime toggling

## Integration Points

### useAppState Hook

The main integration happens in `useAppState` hook:

```typescript
// Token counter hook - only used when feature is enabled
const workerTokensEnabled = FeatureControl.isEnabled();
const { countTokens: workerCountTokens, countTokensBatch, isReady } = useTokenCounter();
```

### File Loading

The `loadFileContent` function now:
1. Checks if worker tokens are enabled
2. Sets loading state (`isCountingTokens: true`)
3. Counts tokens asynchronously
4. Updates state with results
5. Falls back to estimation on error

### Batch Processing

The new `loadMultipleFileContents` function:
1. Loads multiple files concurrently
2. Uses `countTokensBatch` for efficiency
3. Updates all files atomically
4. Handles partial failures gracefully

## UI Updates

### FileData Type

Added new fields:
- `isCountingTokens?: boolean` - Shows loading state
- `tokenCountError?: string` - Error details

### File Card Component

Updated to show:
- "Counting tokens..." during processing
- Error messages if counting fails
- Smooth transitions between states

## Performance Characteristics

- **Latency**: <100ms for files under 100KB
- **Worker initialization**: <500ms on first use
- **Memory per worker**: <50MB baseline, <100MB peak
- **Concurrent processing**: Scales linearly with worker count

## Usage

### Enable the Feature

```typescript
// Via URL parameter
?worker-tokens=true

// Via code
FeatureControl.enable();

// Check status
if (workerTokensEnabled) {
  // Use worker-based counting
}
```

### Monitor Performance

```typescript
const { getPerformanceStats } = useTokenCounter();
const stats = getPerformanceStats();
console.log(stats);
// {
//   processedCount: 150,
//   totalProcessingTime: 5000,
//   avgProcessingTime: 33.33,
//   failureCount: 0,
//   queueLength: 0,
//   activeWorkers: 4
// }
```

## Testing

Use the `WorkerIntegrationTest` component to verify:
1. Single file token counting
2. Batch file processing
3. File selection workflow
4. Performance characteristics

## Rollback

If issues occur:

1. **Automatic**: High error rates trigger automatic disable
2. **Manual**: `FeatureControl.disable()` or UI toggle
3. **Emergency**: Delete localStorage key `enable-worker-tokens`

## Migration Notes

- Existing token counts remain valid
- No data migration required
- Backward compatible with IPC-based counting
- Cache system works with both methods

## Future Improvements

1. Priority queue for smaller files
2. Persistent performance metrics
3. WebAssembly optimization
4. Streaming support for large files
5. Custom encoding support beyond o200k_base