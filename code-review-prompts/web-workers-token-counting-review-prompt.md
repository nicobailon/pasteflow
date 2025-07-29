# Code Review Prompt: Web Workers Token Counting Implementation

You are reviewing a critical performance improvement in PasteFlow - the implementation of Web Workers for token counting operations. This feature moves expensive tiktoken operations from the main/renderer thread to background workers to prevent UI freezing.

## Context

PasteFlow is an Electron-based developer tool that helps developers browse, select, and copy code from repositories. Token counting is essential for estimating LLM context usage, but the current synchronous implementation causes UI freezes when processing large files.

**Key Implementation Files to Review:**
- `src/workers/token-worker.ts` - Web Worker implementation
- `src/utils/worker-pool.ts` - Worker pool management
- `src/hooks/use-token-counter.ts` - React integration hook
- `src/hooks/use-app-state.ts` - Main state integration
- `vite-config.ts` - Build configuration changes

## Review Checklist

### 1. Correctness & Functionality

**Token Counting Accuracy**
- [ ] Verify token counts match the original tiktoken implementation
- [ ] Check that o200k_base encoding is properly initialized
- [ ] Validate text sanitization is maintained (e.g., `<|endoftext|>` removal)
- [ ] Ensure fallback estimation (4 chars/token) works correctly
- [ ] Verify batch processing produces correct results

**Worker Lifecycle**
- [ ] Workers initialize properly with tiktoken/wasm
- [ ] Workers terminate cleanly on unmount
- [ ] Memory is properly released after processing
- [ ] Worker pool size adapts to hardware (navigator.hardwareConcurrency)

**Integration Points**
- [ ] `loadFileContent` properly uses async token counting
- [ ] File selection state updates work with async counts
- [ ] Token count caching is maintained
- [ ] Real-time updates don't cause race conditions

### 2. Performance Verification

**Blocking Behavior**
- [ ] Main thread never blocks for >16ms (60fps maintained)
- [ ] Verify UI remains responsive during large file processing
- [ ] Check that progress indicators work for long operations
- [ ] Batch processing scales linearly with worker count

**Resource Usage**
- [ ] Memory per worker stays under 50MB limit
- [ ] CPU usage is distributed across cores
- [ ] No memory leaks during extended usage
- [ ] Worker startup time is <200ms

**Performance Targets**
- [ ] 1MB file processes in <500ms
- [ ] 100 files batch completes in <2s with 4 workers
- [ ] At least 50% reduction in UI freeze time

### 3. Security Analysis

**Worker Isolation**
- [ ] Workers cannot access file system
- [ ] Workers only receive text content, never file paths
- [ ] Input size limits prevent DOS attacks
- [ ] No sensitive data leaks to workers

**Input Validation**
- [ ] Text content is validated before sending to workers
- [ ] Maximum input size is enforced (suggest 10MB limit)
- [ ] Malformed data doesn't crash workers
- [ ] Binary content is properly rejected

### 4. Error Handling & Edge Cases

**Failure Scenarios**
- [ ] Worker initialization failure falls back gracefully
- [ ] Individual worker crashes don't affect others
- [ ] Network/WASM loading failures are handled
- [ ] Out of memory conditions are caught

**Edge Cases to Test**
- [ ] Empty strings return 0 tokens
- [ ] Very large files (>10MB) are handled or rejected gracefully
- [ ] Unicode and special characters work correctly
- [ ] Concurrent requests don't interfere
- [ ] Rapid file selection doesn't cause queue overflow

**Error Recovery**
- [ ] Failed workers are replaced automatically
- [ ] Queue items are retried on failure
- [ ] User sees meaningful error messages
- [ ] Application remains functional after errors

### 5. Code Quality & Architecture

**Design Patterns**
- [ ] Worker pool pattern is correctly implemented
- [ ] Queue management prevents resource exhaustion
- [ ] Promises/async patterns are used correctly
- [ ] No race conditions in concurrent operations

**TypeScript & Type Safety**
- [ ] All worker messages are properly typed
- [ ] No use of `any` type
- [ ] Worker pool API has precise types
- [ ] Error types are well-defined

**React Integration**
- [ ] Hook properly manages worker lifecycle
- [ ] No memory leaks from effect cleanup
- [ ] State updates are batched appropriately
- [ ] Re-renders are minimized

### 6. Testing Coverage

**Required Tests**
- [ ] Worker initialization and termination
- [ ] Token counting accuracy matches tiktoken
- [ ] Concurrent request handling
- [ ] Memory leak detection over time
- [ ] Performance benchmarks meet targets
- [ ] Fallback mechanisms work correctly
- [ ] Queue overflow prevention
- [ ] Worker crash recovery

**Test Scenarios**
- [ ] Process a 5MB JavaScript file
- [ ] Select 500 files simultaneously  
- [ ] Kill a worker mid-processing
- [ ] Simulate WASM loading failure
- [ ] Test with system under memory pressure
- [ ] Verify counts for files with emoji/unicode

### 7. Specific Areas of Concern

**Vite/Build Configuration**
```typescript
// Check these specific configurations:
worker: {
  format: 'es',  // Correct for tiktoken?
  plugins: []    // WASM plugin needed?
},
optimizeDeps: {
  exclude: ['tiktoken']  // Prevents pre-bundling issues?
}
```

**Memory Management**
```typescript
// Verify this pattern doesn't leak:
const cached = fileContentCache.get(filePath);
if (cached) {
  // Is old cache entry cleared?
}
```

**Queue Handling**
```typescript
// Check for queue overflow:
if (this.queue.length > MAX_QUEUE_SIZE) {
  // What happens? Should reject or use FIFO?
}
```

### 8. Compatibility Checks

- [ ] Works in Electron's renderer process
- [ ] Compatible with current Electron version (v34.3.0)
- [ ] Vite dev server supports workers
- [ ] Production build includes worker files
- [ ] Cross-platform functionality (Windows/Mac/Linux)

### 9. User Experience

- [ ] Loading states are clear during processing
- [ ] Progress is shown for batch operations
- [ ] Cancellation works mid-operation
- [ ] Error messages are user-friendly
- [ ] No regression in existing features

### 10. Documentation Review

- [ ] Worker pool API is documented
- [ ] Error handling strategies explained
- [ ] Performance characteristics noted
- [ ] Configuration options described
- [ ] Migration guide for developers

## Critical Questions to Answer

1. **Does the implementation actually prevent UI freezing?** Test with a 10MB file and verify the UI remains at 60fps.

2. **Is the fallback mechanism reliable?** Disable workers and ensure the app still functions.

3. **Are there any memory leaks?** Run the app for 24 hours processing files continuously.

4. **Is the implementation secure?** Try sending malicious input to workers.

5. **Does it work in production?** Build and test the packaged Electron app.

## Review Output Format

Please provide your review in the following format:

```markdown
## Summary
[Overall assessment: APPROVE/NEEDS WORK/REJECT]

## Critical Issues
1. [Issue description, severity, and suggested fix]

## Performance Results
- UI freeze reduction: [measured %]
- 1MB file processing: [measured time]
- Memory usage per worker: [measured MB]

## Security Findings
[Any security concerns found]

## Suggested Improvements
1. [Improvement with rationale]

## Code Examples
[Specific code snippets that need attention]
```

Remember: The goal is 50% reduction in UI freeze time while maintaining 100% accuracy in token counting. This is a critical performance feature that directly impacts user experience.