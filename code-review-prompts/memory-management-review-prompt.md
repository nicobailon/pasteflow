# Memory Management Code Review Meta Prompt

You are conducting a thorough code review of memory management enhancements for PasteFlow, an Electron-based developer tool. The implementation aims to reduce memory usage by 30% through aggressive garbage collection, memory pressure monitoring, and optimized data structures.

## Review Context

PasteFlow is an Electron application that:
- Processes and displays thousands of files from repositories
- Caches file content for performance
- Provides real-time token counting for AI context estimation
- Runs in both main and renderer processes with IPC communication

The memory enhancement implementation includes:
1. Streaming file processing to avoid bulk accumulation
2. Enhanced cache with memory limits and compression
3. Real-time memory pressure monitoring
4. Adaptive garbage collection scheduling
5. Virtual file lists for large datasets

## Review Focus Areas

### 1. Memory Leak Detection

**Critical Review Points:**
- Event listener cleanup in components and hooks
- IPC handler removal on unmount
- Timer and interval cleanup
- Cache entry lifecycle management
- Circular reference prevention

**Review Checklist:**
```typescript
// Check for these patterns:
- [ ] All addEventListener calls have corresponding removeEventListener
- [ ] All setInterval/setTimeout have clearInterval/clearTimeout
- [ ] IPC handlers are properly removed in cleanup functions
- [ ] React effects return cleanup functions where needed
- [ ] WeakMap/WeakSet used for object references where appropriate
```

**Questions to Ask:**
1. Are there any event listeners that might accumulate over time?
2. Do all React components properly clean up subscriptions?
3. Are file references properly released when no longer needed?
4. Could the cache grow unbounded under any scenario?
5. Are there circular references between cached objects?

### 2. Performance Regression Risks

**Critical Review Points:**
- Garbage collection frequency and timing
- UI thread blocking operations
- Cache hit/miss ratio impact
- File loading latency changes
- Memory allocation patterns

**Performance Metrics to Verify:**
```typescript
// Expected performance characteristics:
- File loading: < 3s for 10,000 files
- Memory pressure events: < 5 per hour
- Cache hit rate: > 80%
- GC pause time: < 50ms
- UI frame rate: > 30fps during file operations
```

**Questions to Ask:**
1. Does aggressive GC cause noticeable UI stuttering?
2. Is file content loading still responsive with the sliding window?
3. Are memory pressure calculations accurate across platforms?
4. Could the compression overhead outweigh memory savings?
5. Is the virtual file list scroll performance acceptable?

### 3. Electron-Specific Memory Concerns

**Main Process Review:**
```javascript
// Check main.js for:
- [ ] No accumulation of file data in global scope
- [ ] Proper cleanup of file watchers
- [ ] IPC message size limits respected
- [ ] No retention of closed window references
- [ ] Worker thread cleanup on completion
```

**Renderer Process Review:**
```typescript
// Check renderer for:
- [ ] DOM node limits with virtual scrolling
- [ ] Image/blob URL cleanup
- [ ] Detached DOM node prevention
- [ ] SharedArrayBuffer usage (if any)
- [ ] Context isolation compliance
```

**IPC Communication Review:**
- Are large payloads chunked appropriately?
- Is backpressure handled for rapid IPC calls?
- Are there memory spikes during file transfers?
- Is the 128MB IPC message limit respected?

### 4. Testing Completeness for Memory Scenarios

**Test Coverage Requirements:**

**Unit Tests Must Verify:**
```typescript
// Memory limit enforcement
it('should enforce sliding window size under memory pressure')
it('should trigger GC when pressure exceeds threshold')
it('should compress content above size threshold')
it('should evict cache entries by priority')

// Edge cases
it('should handle rapid file selection/deselection')
it('should recover from OOM scenarios gracefully')
it('should maintain data integrity during cleanup')
```

**Integration Tests Must Verify:**
```typescript
// End-to-end scenarios
it('should process 50,000+ files without OOM')
it('should maintain < 500MB heap usage over 1 hour')
it('should clean up memory after workspace switch')
it('should handle multiple large workspaces')
```

**Performance Tests Must Include:**
- Memory usage baseline measurements
- Memory growth over time analysis
- Peak memory usage identification
- Memory recovery after operations

### 5. Code Quality and Maintainability

**Architecture Review:**
- Is the memory monitor properly decoupled?
- Are memory thresholds configurable?
- Is the caching strategy consistent across components?
- Are memory utilities properly typed?
- Is error handling comprehensive?

**TypeScript Specific:**
```typescript
// Verify strict typing for:
- Memory metrics interfaces
- Cache configuration types
- Event payload types
- Garbage collection options
- Performance measurements
```

### 6. Security Implications

**Memory-Related Security Checks:**
- No sensitive data persisted in caches
- Proper cleanup of authentication tokens
- No memory dumps containing user data
- Secure cleanup of temporary files
- Protection against memory exhaustion attacks

## Review Methodology

### Step 1: Static Analysis
Run these checks before manual review:
```bash
# Memory leak detection
npm run lint:memory

# Bundle size analysis
npm run analyze:bundle

# Type checking
npm run typecheck

# Performance profiling
npm run profile:memory
```

### Step 2: Runtime Analysis
1. Open Chrome DevTools Memory Profiler
2. Take heap snapshot before operations
3. Perform file loading, selection, workspace switching
4. Take heap snapshot after operations
5. Compare snapshots for retained objects

### Step 3: Stress Testing
```typescript
// Stress test scenarios:
1. Load repository with 100,000+ files
2. Rapidly switch between workspaces
3. Select/deselect all files repeatedly
4. Open multiple file view modals
5. Leave application running for 24 hours
```

### Step 4: Platform Testing
Test on:
- Windows 10/11 (different memory APIs)
- macOS (different GC behavior)
- Linux (different memory limits)
- Low-memory machines (< 4GB RAM)

## Common Pitfalls to Check

1. **Assuming `global.gc` exists**
   - Always check availability before calling
   - Provide fallback behavior

2. **Memory API availability**
   - `performance.memory` not available in all browsers
   - Feature detection required

3. **Compression overhead**
   - Small files may use more memory compressed
   - CPU overhead may impact performance

4. **Event emitter leaks**
   - Default max listeners is 10
   - May need to increase for legitimate use

5. **React re-render storms**
   - Memory monitoring updates causing cascading renders
   - Use React.memo and useMemo appropriately

## Expected Outcomes

After successful implementation, verify:

1. **Memory Usage**: 30% reduction in average heap usage
2. **Performance**: No regression in file loading times
3. **Stability**: No increase in crash rate
4. **User Experience**: Smooth scrolling and interactions
5. **Developer Experience**: Clear memory debugging tools

## Review Deliverables

Your review should provide:

1. **Risk Assessment**: High/Medium/Low for each component
2. **Memory Leak Report**: Any potential leaks found
3. **Performance Impact**: Measured impact on operations
4. **Test Coverage Gaps**: Missing test scenarios
5. **Recommendations**: Specific improvements needed
6. **Approval Status**: Ready to merge / Needs changes

## Code Review Checklist Summary

- [ ] All memory allocations have corresponding deallocations
- [ ] Event listeners and timers are properly cleaned up
- [ ] Cache size limits are enforced
- [ ] Memory pressure triggers appropriate cleanup
- [ ] Garbage collection doesn't impact user experience
- [ ] IPC messages respect size limits
- [ ] Virtual scrolling maintains reasonable DOM size
- [ ] Compression provides net benefit
- [ ] Error scenarios don't leak memory
- [ ] Tests cover memory edge cases
- [ ] Platform differences are handled
- [ ] Security implications addressed
- [ ] Performance metrics are acceptable
- [ ] Code is maintainable and well-documented

Remember: The goal is working software that uses memory efficiently without sacrificing user experience. Focus on real-world usage patterns and ensure the implementation is robust across different scenarios and platforms.