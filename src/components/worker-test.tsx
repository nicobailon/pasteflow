import React, { useState, useCallback } from 'react';
import { useTokenCounter } from '../hooks/use-token-counter';

export const WorkerTest = () => {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const { countTokens, countTokensBatch, getPerformanceStats, isReady } = useTokenCounter();

  const addResult = (result: string) => {
    setTestResults((prev: string[]) => [...prev, `[${new Date().toISOString()}] ${result}`]);
  };

  const runTests = useCallback(async () => {
    if (!isReady) {
      addResult('Worker pool not ready');
      return;
    }

    setIsRunning(true);
    addResult('Starting worker pool tests...');

    try {
      // Test 1: Small text
      const smallText = 'Hello, world! This is a test.';
      const start1 = performance.now();
      const count1 = await countTokens(smallText);
      const time1 = performance.now() - start1;
      addResult(`Small text (${smallText.length} chars): ${count1} tokens in ${time1.toFixed(2)}ms`);

      // Test 2: Medium text (1KB)
      const mediumText = 'Lorem ipsum dolor sit amet. '.repeat(40);
      const start2 = performance.now();
      const count2 = await countTokens(mediumText);
      const time2 = performance.now() - start2;
      addResult(`Medium text (${mediumText.length} chars): ${count2} tokens in ${time2.toFixed(2)}ms`);

      // Test 3: Large text (100KB)
      const largeText = 'The quick brown fox jumps over the lazy dog. '.repeat(2500);
      const start3 = performance.now();
      const count3 = await countTokens(largeText);
      const time3 = performance.now() - start3;
      addResult(`Large text (${largeText.length} chars): ${count3} tokens in ${time3.toFixed(2)}ms`);

      // Test 4: Batch processing
      const batchTexts = Array(10).fill(null).map((_, i) => 
        `Batch text ${i}: ${mediumText.slice(0, 100)}`
      );
      const start4 = performance.now();
      const batchCounts = await countTokensBatch(batchTexts);
      const time4 = performance.now() - start4;
      addResult(`Batch processing (${batchTexts.length} texts): ${batchCounts.reduce((a: number, b: number) => a + b, 0)} total tokens in ${time4.toFixed(2)}ms`);

      // Test 5: Concurrent requests
      const concurrentPromises = Array(5).fill(null).map((_, i) => 
        countTokens(`Concurrent test ${i}: ${mediumText}`)
      );
      const start5 = performance.now();
      const concurrentResults = await Promise.all(concurrentPromises);
      const time5 = performance.now() - start5;
      addResult(`Concurrent processing (5 requests): ${concurrentResults.reduce((a, b) => a + b, 0)} total tokens in ${time5.toFixed(2)}ms`);

      // Get performance stats
      const stats = getPerformanceStats();
      addResult(`\nPerformance Stats:`);
      addResult(`  Total processed: ${stats.totalProcessed}`);
      addResult(`  Average time: ${stats.averageTime.toFixed(2)}ms`);
      addResult(`  Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
      addResult(`  Failures: ${stats.failureCount}`);

    } catch (error) {
      addResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunning(false);
      addResult('Tests completed.');
    }
  }, [isReady, countTokens, countTokensBatch, getPerformanceStats]);

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Web Worker Token Counting Test</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={runTests} 
          disabled={!isReady || isRunning}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: isRunning || !isReady ? 'not-allowed' : 'pointer',
            backgroundColor: isRunning || !isReady ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          {isRunning ? 'Running Tests...' : 'Run Tests'}
        </button>
        <span style={{ marginLeft: '10px', color: isReady ? 'green' : 'red' }}>
          Worker Pool: {isReady ? 'Ready' : 'Not Ready'}
        </span>
      </div>

      <div style={{
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: '4px',
        padding: '10px',
        height: '400px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        {testResults.length === 0 ? (
          <div style={{ color: '#666' }}>Test results will appear here...</div>
        ) : (
          testResults.map((result: string, index: number) => (
            <div key={index} style={{ marginBottom: '4px' }}>
              {result}
            </div>
          ))
        )}
      </div>
    </div>
  );
};