# Code Review Meta Prompt: Search Indexing Implementation

## Context

You are reviewing the implementation of a search indexing system for PasteFlow, an Electron-based developer tool. The implementation replaces a linear O(n) search with an inverted index to achieve 90% performance improvement for large codebases (10,000+ files).

## Review Objectives

Your review should ensure the implementation:
1. **Achieves Performance Targets**: 90% search time reduction for 10k+ files
2. **Maintains Type Safety**: Strict TypeScript with no `any` types
3. **Handles Scale**: Efficiently processes 100k+ files
4. **Preserves Functionality**: All existing search features continue working
5. **Ensures Reliability**: No crashes, memory leaks, or data corruption

## Code Review Checklist

### 1. Architecture & Design (25%)

#### Index Structure
- [ ] Verify the inverted index data structure is memory-efficient
- [ ] Check that the index supports all required search types (exact, prefix, fuzzy)
- [ ] Ensure proper separation between indexing and searching logic
- [ ] Validate that index updates don't block the UI thread

#### Type Safety
- [ ] No `any` types used anywhere in the implementation
- [ ] All data structures use readonly modifiers where appropriate
- [ ] Branded types used for validated file paths
- [ ] Discriminated unions for message types if using Workers

#### Integration Points
- [ ] Index building integrates cleanly with file loading pipeline
- [ ] Search seamlessly replaces the linear implementation
- [ ] Proper fallback to linear search if index unavailable
- [ ] Index persistence doesn't interfere with other storage

### 2. Performance Analysis (25%)

#### Search Performance
```typescript
// Verify these performance characteristics:
- Initial search: < 50ms for 10,000 files
- Subsequent searches: < 20ms (with caching)
- Index build time: < 1 second for 10,000 files
- Memory usage: < 50MB for 100,000 files
```

#### Critical Performance Checks
- [ ] Tokenization is optimized (no regex in hot paths)
- [ ] Index lookups use efficient data structures (Map/Set)
- [ ] Results are lazily evaluated when possible
- [ ] Memory is properly released after operations

#### Benchmarks to Run
```typescript
// Test with these scenarios:
1. 1,000 files - baseline performance
2. 10,000 files - target scenario  
3. 100,000 files - stress test
4. Deep nesting (10+ levels)
5. Long file paths (200+ chars)
6. Unicode filenames
```

### 3. Correctness & Accuracy (20%)

#### Search Accuracy
- [ ] All files matching the query are found (no false negatives)
- [ ] No irrelevant files in results (no false positives)
- [ ] Case-insensitive search works correctly
- [ ] Special characters are handled properly
- [ ] Path separators work cross-platform

#### Edge Cases
- [ ] Empty search query behavior
- [ ] Single character searches
- [ ] Very long search queries (100+ chars)
- [ ] Special regex characters in queries
- [ ] Searching in empty folders
- [ ] Files with no extension

### 4. Memory Management (15%)

#### Memory Efficiency
- [ ] Index size is proportional to file count
- [ ] No memory leaks during index updates
- [ ] Proper cleanup when switching folders
- [ ] WeakMap/WeakSet used where appropriate

#### Resource Monitoring
```typescript
// Check memory usage:
const before = performance.memory.usedJSHeapSize;
// Run indexing operation
const after = performance.memory.usedJSHeapSize;
const increase = after - before;
// Should be < 500 bytes per file
```

### 5. Error Handling & Resilience (10%)

#### Error Scenarios
- [ ] Corrupted index data handling
- [ ] File system errors during indexing
- [ ] Out of memory scenarios
- [ ] Invalid file paths
- [ ] Concurrent modification handling

#### Recovery Mechanisms
- [ ] Index can be rebuilt from scratch
- [ ] Partial index updates don't corrupt data
- [ ] Clear error messages for users
- [ ] Graceful degradation to linear search

### 6. Code Quality (5%)

#### Implementation Standards
- [ ] Functions are under 50 lines
- [ ] Cyclomatic complexity < 10
- [ ] Clear variable and function names
- [ ] Proper documentation for complex algorithms
- [ ] No code duplication

## Specific Areas to Focus On

### 1. Tokenization Logic
Review the `tokenizePath` and `tokenizeQuery` functions:
```typescript
// Ensure these handle:
- Path separators (/, \)  
- File extensions
- CamelCase/snake_case splitting
- Special characters
- Unicode normalization
```

### 2. Index Building
Check the `buildSearchIndex` function:
```typescript
// Verify:
- Batch processing doesn't block UI
- Progress reporting is accurate
- Cancellation works properly
- Memory usage stays bounded
```

### 3. Search Algorithm
Examine the search implementation:
```typescript
// Validate:
- Scoring algorithm is fair
- Results are deterministic
- Ranking makes sense to users
- Performance scales linearly with results
```

### 4. Web Worker Integration (if implemented)
```typescript
// Check:
- Proper message passing protocol
- Error handling across thread boundary
- Graceful fallback if Workers unavailable
- No shared memory issues
```

## Testing Requirements

### Required Test Coverage
- Unit tests: 90%+ coverage of search logic
- Integration tests: Full search workflow
- Performance tests: All benchmark scenarios
- Edge case tests: All identified edge cases

### Key Test Scenarios
```typescript
describe('Search Index', () => {
  it('should find files by partial name match');
  it('should find files by path components');
  it('should handle special characters in queries');
  it('should maintain performance with 100k files');
  it('should recover from corrupted index');
  it('should update index incrementally');
  it('should respect memory limits');
});
```

## Review Output Format

Structure your review as follows:

```markdown
# Search Indexing Implementation Review

## Summary
[Overall assessment: APPROVED/NEEDS CHANGES/REJECTED]

## Strengths
- [List key strengths of the implementation]

## Critical Issues
- [List any blocking issues that must be fixed]

## Performance Results
- 10k files search time: [actual] vs 50ms target
- Index build time: [actual] vs 1s target  
- Memory usage: [actual] vs 50MB target

## Recommendations
1. [Specific improvements needed]
2. [Performance optimizations]
3. [Code quality enhancements]

## Security Considerations
- [Any security issues found]
- [Recommended mitigations]

## Test Coverage Analysis
- Unit test coverage: [X]%
- Missing test scenarios: [list]
- Performance test results: [summary]
```

## Red Flags to Watch For

1. **Type Safety Violations**
   - Any use of `any` type
   - Type assertions without validation
   - Missing null checks

2. **Performance Anti-patterns**
   - Synchronous file operations
   - Unbounded loops
   - Excessive memory allocation
   - Regex in hot code paths

3. **Memory Leaks**
   - Event listeners not cleaned up
   - Circular references
   - Large objects kept in closures
   - Missing index cleanup

4. **Security Issues**
   - Unvalidated file paths
   - Regex DoS vulnerabilities
   - Path traversal possibilities

## Success Criteria

The implementation should be approved if:
1. ✅ Achieves 90% search performance improvement
2. ✅ Maintains strict TypeScript standards
3. ✅ Handles 100k+ files without degradation
4. ✅ All existing search features work correctly
5. ✅ No memory leaks or crashes observed
6. ✅ 90%+ test coverage with meaningful tests
7. ✅ Clear documentation and error handling

Use this prompt to conduct a thorough, objective review that ensures the search indexing implementation meets PasteFlow's high standards for performance, reliability, and code quality.