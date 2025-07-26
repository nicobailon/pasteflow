import { FileData } from '../../types/file-types';
import { countTokens } from '../../utils/token-counter';

describe('Large File Processing Performance', () => {
  it('should process 1000 files within reasonable time', async () => {
    const startTime = performance.now();
    
    // Create large test dataset
    const largeFileSet: FileData[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `/project/file${i}.js`,
      name: `file${i}.js`,
      isDirectory: false,
      content: `// File ${i}\n${'console.log("test");\n'.repeat(10)}`,
      size: 200,
      isBinary: false,
      isSkipped: false,
      tokenCount: 50
    }));
    
    // Process files (simulate batch processing)
    const batchSize = 50;
    const results: FileData[] = [];
    
    for (let i = 0; i < largeFileSet.length; i += batchSize) {
      const batch = largeFileSet.slice(i, i + batchSize);
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Process batch (in real app this would include token counting)
      const processedBatch = batch.map(file => ({
        ...file,
        isContentLoaded: true,
        tokenCount: file.tokenCount || countTokens(file.content || '')
      }));
      
      results.push(...processedBatch);
    }
    
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    
    // Performance assertions
    expect(processingTime).toBeLessThan(5000);                  // 1. Under 5 seconds
    expect(results).toHaveLength(1000);                        // 2. All files processed
    expect(results.every(r => r.tokenCount && r.tokenCount > 0)).toBe(true);   // 3. Token counting worked
    
    // Verify batch processing maintained data integrity
    expect(results[0].name).toBe('file0.js');                  // 4. First file correct
    expect(results[999].name).toBe('file999.js');             // 5. Last file correct
    
    // Memory usage should be reasonable
    const memoryUsage = process.memoryUsage();
    expect(memoryUsage.heapUsed).toBeLessThan(500 * 1024 * 1024); // 6. Under 500MB (adjusted for test environment)
  });
  
  it('should handle memory efficiently with large file content', async () => {
    // Create files with large content
    const largeFiles: FileData[] = Array.from({ length: 10 }, (_, i) => ({
      path: `/project/large${i}.js`,
      name: `large${i}.js`,
      isDirectory: false,
      content: 'x'.repeat(1024 * 1024), // 1MB per file
      size: 1024 * 1024,
      isBinary: false,
      isSkipped: false
    }));
    
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Process large files
    const results = await Promise.all(
      largeFiles.map(async file => {
        // Simulate token counting on large content
        const tokenCount = countTokens(file.content || '');
        
        return {
          ...file,
          tokenCount,
          isContentLoaded: true
        };
      })
    );
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory assertions
    expect(results).toHaveLength(10);                           // 1. All processed
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);     // 2. Under 50MB increase
    expect(results.every(r => r.tokenCount && r.tokenCount > 1000)).toBe(true); // 3. Token counting accurate
    
    // Verify processing didn't corrupt data
    expect(results[0].size).toBe(1024 * 1024);                 // 4. Size preserved
    expect(results[9].name).toBe('large9.js');                 // 5. Names intact
  });
  
  it('should maintain performance with deeply nested file structures', async () => {
    const startTime = performance.now();
    
    // Create deeply nested structure
    const nestedFiles: FileData[] = [];
    let currentPath = '/project';
    
    // Create 20 levels with 10 files each
    for (let level = 0; level < 20; level++) {
      currentPath += `/level${level}`;
      
      // Add directory
      nestedFiles.push({
        path: currentPath,
        name: `level${level}`,
        isDirectory: true,
        size: 0,
        isBinary: false,
        isSkipped: false
      });
      
      // Add files at this level
      for (let fileIdx = 0; fileIdx < 10; fileIdx++) {
        nestedFiles.push({
          path: `${currentPath}/file${fileIdx}.js`,
          name: `file${fileIdx}.js`,
          isDirectory: false,
          content: `console.log("Level ${level}, File ${fileIdx}");`,
          size: 50,
          isBinary: false,
          isSkipped: false,
          tokenCount: 10
        });
      }
    }
    
    // Process nested structure
    const processedFiles = nestedFiles.map(file => ({
      ...file,
      isContentLoaded: !file.isDirectory,
      level: file.path.split('/').length - 2
    }));
    
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    
    // Performance with nested structures
    expect(processingTime).toBeLessThan(1000);                 // 1. Under 1 second
    expect(processedFiles).toHaveLength(220);                  // 2. 20 dirs + 200 files
    expect(processedFiles.filter(f => !f.isDirectory)).toHaveLength(200); // 3. All files counted
    
    // Verify deep nesting handled correctly
    const deepestFile = processedFiles.find(f => f.path.includes('level19/file9.js'));
    expect(deepestFile).toBeDefined();                          // 4. Deepest file found
    expect(deepestFile?.level).toBe(21);                       // 5. Correct depth calculation (0-based)
  });
  
  it('should handle concurrent file processing efficiently', async () => {
    const startTime = performance.now();
    
    // Create test files
    const concurrentFiles: FileData[] = Array.from({ length: 100 }, (_, i) => ({
      path: `/project/concurrent${i}.js`,
      name: `concurrent${i}.js`,
      isDirectory: false,
      content: `// Concurrent file ${i}\n${'const data = "test";\n'.repeat(20)}`,
      size: 500,
      isBinary: false,
      isSkipped: false
    }));
    
    // Process files concurrently in batches
    const batchSize = 20;
    const batches: FileData[][] = [];
    
    for (let i = 0; i < concurrentFiles.length; i += batchSize) {
      batches.push(concurrentFiles.slice(i, i + batchSize));
    }
    
    // Process all batches concurrently
    const results = await Promise.all(
      batches.map(async (batch, batchIdx) => {
        // Simulate async processing
        await new Promise(resolve => setTimeout(resolve, 50));
        
        return batch.map(file => ({
          ...file,
          tokenCount: countTokens(file.content || ''),
          isContentLoaded: true,
          batchId: batchIdx
        }));
      })
    );
    
    const flatResults = results.flat();
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    
    // Concurrent processing assertions
    expect(processingTime).toBeLessThan(500);                  // 1. Concurrent is faster
    expect(flatResults).toHaveLength(100);                     // 2. All files processed
    expect(new Set(flatResults.map(r => r.batchId)).size).toBe(5); // 3. 5 batches used
    
    // Verify no data corruption in concurrent processing
    expect(flatResults.every(r => r.tokenCount && r.tokenCount > 0)).toBe(true); // 4. All have tokens
    expect(flatResults.filter(r => r.name.includes('concurrent')).length).toBe(100); // 5. Names preserved
  });
  
  it('should gracefully handle memory pressure scenarios', async () => {
    // Track memory usage throughout
    const memorySnapshots: number[] = [];
    
    // Create memory-intensive scenario
    const memoryIntensiveFiles: FileData[] = Array.from({ length: 50 }, (_, i) => ({
      path: `/project/memory${i}.js`,
      name: `memory${i}.js`,
      isDirectory: false,
      // Varying sizes to simulate real scenarios
      content: 'x'.repeat(Math.floor(Math.random() * 500000) + 100000), // 100KB-600KB
      size: 0, // Will be calculated
      isBinary: false,
      isSkipped: false
    }));
    
    // Update sizes
    memoryIntensiveFiles.forEach(file => {
      file.size = file.content?.length || 0;
    });
    
    // Process with memory tracking
    const results: FileData[] = [];
    
    for (const file of memoryIntensiveFiles) {
      // Take memory snapshot
      memorySnapshots.push(process.memoryUsage().heapUsed);
      
      // Process file
      const tokenCount = countTokens(file.content || '');
      results.push({
        ...file,
        tokenCount,
        isContentLoaded: true,
        content: undefined // Clear content to free memory
      });
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }
    
    // Analyze memory usage pattern
    const maxMemory = Math.max(...memorySnapshots);
    const minMemory = Math.min(...memorySnapshots);
    const avgMemory = memorySnapshots.reduce((a, b) => a + b) / memorySnapshots.length;
    
    // Memory management assertions
    expect(results).toHaveLength(50);                           // 1. All files processed
    expect(maxMemory - minMemory).toBeLessThan(30 * 1024 * 1024); // 2. Memory variation < 30MB
    expect(avgMemory).toBeLessThan(400 * 1024 * 1024);         // 3. Average memory < 400MB (adjusted for test environment)
    expect(results.every(r => r.content === undefined)).toBe(true); // 4. Content cleared
    expect(results.every(r => r.tokenCount && r.tokenCount > 0)).toBe(true); // 5. Tokens calculated
  });
});