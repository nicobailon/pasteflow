# Search Indexing Implementation Plan for PasteFlow

## Executive Summary

This plan outlines the implementation of an inverted index for PasteFlow's file search functionality, targeting a 90% performance improvement for large codebases (10,000+ files). The current linear search implementation (O(n) complexity) will be replaced with an indexed search (O(log n) lookup with O(k) result retrieval).

## Current State Analysis

### Existing Implementation
- **Location**: `src/handlers/filter-handlers.ts:24-30`
- **Method**: Linear search through all files using `String.includes()`
- **Search Fields**: File path and name only
- **Performance**: O(n) where n = total files
- **Limitations**: 
  - No content search
  - No fuzzy matching
  - Poor performance on large codebases
  - Case-insensitive only

### Performance Bottlenecks
1. Every search requires iterating through all files
2. No caching of search results
3. Content search would require loading all files into memory
4. No ranking or relevance scoring

## Proposed Architecture

### 1. Inverted Index Design

```typescript
// Core index structure
interface SearchIndex {
  // Token -> Set of file paths containing the token
  readonly tokenToFiles: Map<string, Set<string>>;
  
  // File path -> metadata for ranking
  readonly fileMetadata: Map<string, FileSearchMetadata>;
  
  // Trigram index for fuzzy search
  readonly trigramIndex: Map<string, Set<string>>;
  
  // Statistics for TF-IDF scoring
  readonly stats: IndexStatistics;
}

interface FileSearchMetadata {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly tokenCount: number;
  readonly lastModified: number;
  readonly termFrequencies: Map<string, number>;
}

interface IndexStatistics {
  readonly totalFiles: number;
  readonly totalTokens: number;
  readonly avgTokensPerFile: number;
  readonly lastBuilt: number;
}
```

### 2. Indexing Strategy

#### Phase 1: Basic Path/Name Index
- Tokenize file paths and names
- Build inverted index mapping tokens to files
- Store in memory with persistence to IndexedDB
- Support exact and prefix matching

#### Phase 2: Content Indexing (Optional)
- Index file content for text files under size limit
- Use streaming tokenization to avoid memory issues
- Build trigram index for fuzzy matching
- Implement TF-IDF scoring for relevance

#### Phase 3: Incremental Updates
- Watch for file system changes
- Update index incrementally
- Batch updates for performance
- Background re-indexing when idle

### 3. Search Implementation

```typescript
interface SearchOptions {
  query: string;
  searchIn: 'name' | 'path' | 'content' | 'all';
  fuzzyMatch: boolean;
  caseSensitive: boolean;
  maxResults: number;
  fileTypes?: string[];
}

interface SearchResult {
  file: FileData;
  score: number;
  matches: MatchInfo[];
}

interface MatchInfo {
  field: 'name' | 'path' | 'content';
  positions: Array<{ start: number; end: number }>;
  preview?: string;
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)

1. **Create Index Module** (`src/utils/search-index.ts`)
   - Define TypeScript interfaces with strict typing
   - Implement basic tokenization functions
   - Create index builder class
   - Add index persistence with IndexedDB

2. **Integrate with File Loading**
   - Hook into `requestFileList` handler
   - Build index during initial file scan
   - Store index in memory with WeakMap fallback

3. **Replace Linear Search**
   - Update `applyFiltersAndSort` in `filter-handlers.ts`
   - Implement fallback to linear search if index unavailable
   - Add performance metrics

### Phase 2: Advanced Features (Week 2)

1. **Fuzzy Search**
   - Implement trigram-based fuzzy matching
   - Add edit distance calculations
   - Configure similarity thresholds

2. **Ranking Algorithm**
   - Implement TF-IDF scoring
   - Consider file location (depth penalty)
   - Boost exact matches over partial

3. **Search UI Enhancements**
   - Add search options dropdown
   - Show match highlights
   - Display result count and timing

### Phase 3: Performance & Polish (Week 3)

1. **Optimization**
   - Implement index compression
   - Add query result caching
   - Optimize memory usage

2. **Background Processing**
   - Move indexing to Web Worker
   - Implement progress reporting
   - Add cancellation support

3. **Persistence & Recovery**
   - Save index to IndexedDB
   - Implement index validation
   - Add corruption recovery

## Technical Implementation Details

### 1. Tokenization Strategy
```typescript
// Tokenize paths into searchable terms
function tokenizePath(path: string): string[] {
  // Split on path separators and common delimiters
  const tokens = path.split(/[\/\\._-]/)
    .filter(t => t.length > 1);
  
  // Add camelCase/PascalCase splits
  const expandedTokens = tokens.flatMap(splitCamelCase);
  
  // Add full path as a token
  expandedTokens.push(path);
  
  return expandedTokens.map(t => t.toLowerCase());
}
```

### 2. Index Building
```typescript
async function buildSearchIndex(
  files: FileData[],
  onProgress?: (percent: number) => void
): Promise<SearchIndex> {
  const index = new SearchIndexBuilder();
  
  const batchSize = 1000;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    await Promise.all(batch.map(file => 
      index.addFile(file)
    ));
    
    if (onProgress) {
      onProgress((i + batchSize) / files.length * 100);
    }
    
    // Yield to prevent blocking
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return index.build();
}
```

### 3. Search Algorithm
```typescript
function searchFiles(
  index: SearchIndex,
  options: SearchOptions
): SearchResult[] {
  const tokens = tokenizeQuery(options.query);
  const candidates = new Map<string, number>();
  
  // Find all files containing query tokens
  for (const token of tokens) {
    const files = options.fuzzyMatch 
      ? index.fuzzyLookup(token)
      : index.exactLookup(token);
      
    for (const file of files) {
      candidates.set(file, (candidates.get(file) || 0) + 1);
    }
  }
  
  // Score and rank results
  const results = Array.from(candidates.entries())
    .map(([path, matchCount]) => ({
      file: getFileByPath(path),
      score: calculateScore(path, tokens, matchCount, index)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults);
    
  return results;
}
```

## Performance Targets

- **Initial Index Build**: < 1 second for 10,000 files
- **Search Latency**: < 50ms for 99% of queries
- **Memory Overhead**: < 50MB for 100,000 files
- **Incremental Updates**: < 10ms per file change

## Testing Strategy

### Unit Tests
- Tokenization edge cases
- Index CRUD operations
- Search algorithm correctness
- Scoring function validation

### Integration Tests
- Full indexing pipeline
- Search with real file data
- Performance benchmarks
- Memory usage monitoring

### Performance Tests
```typescript
describe('Search Performance', () => {
  it('should handle 10,000 files in under 50ms', async () => {
    const files = generateTestFiles(10000);
    const index = await buildSearchIndex(files);
    
    const start = performance.now();
    const results = searchFiles(index, { 
      query: 'test',
      maxResults: 100 
    });
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(50);
    expect(results.length).toBeGreaterThan(0);
  });
});
```

## Migration Strategy

1. **Feature Flag**: Add `enableSearchIndex` configuration
2. **Parallel Implementation**: Keep linear search as fallback
3. **Gradual Rollout**: Enable for small folders first
4. **Performance Monitoring**: Track search times and accuracy
5. **Full Migration**: Remove linear search after validation

## Security Considerations

- Sanitize search queries to prevent injection
- Validate file paths before indexing
- Respect workspace boundaries
- Clear index when switching workspaces
- No indexing of sensitive file patterns

## Success Metrics

1. **Performance**: 90% reduction in search time for 10k+ files
2. **Accuracy**: 95% user satisfaction with search results
3. **Memory**: < 5% increase in memory usage
4. **Reliability**: Zero search-related crashes
5. **Adoption**: 80% of users utilize search feature

## Rollback Plan

If issues arise:
1. Revert to linear search via feature flag
2. Clear corrupted index data
3. Investigate and fix issues
4. Re-enable with fixes
5. Monitor closely for 48 hours

## Dependencies

- No new external dependencies required
- Utilize existing `ignore` library for pattern matching
- Built-in browser IndexedDB for persistence
- TypeScript strict mode compliance throughout

## Timeline

- **Week 1**: Core index implementation and basic search
- **Week 2**: Advanced features and UI enhancements  
- **Week 3**: Performance optimization and testing
- **Week 4**: Deployment and monitoring

This implementation will transform PasteFlow's search from a performance bottleneck into a competitive advantage, enabling instant search across massive codebases while maintaining the application's high standards for type safety and code quality.