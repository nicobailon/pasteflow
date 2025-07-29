import { useState } from 'react';

import useAppState from '../hooks/use-app-state';
import { FeatureControl } from '../utils/feature-flags';
import { FileData, SelectedFileWithLines } from '../types/file-types';

const WorkerIntegrationTest = () => {
  const {
    allFiles,
    selectedFiles,
    loadFileContent,
    loadMultipleFileContents,
    workerTokensEnabled,
    toggleFileSelection
  } = useAppState();

  const [testResults, setTestResults] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const log = (message: string) => {
    setTestResults((prev: string[]) => [...prev, `[${new Date().toISOString()}] ${message}`]);
  };

  const runIntegrationTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    
    log('Starting Web Worker Integration Tests...');
    log(`Feature flag enabled: ${workerTokensEnabled}`);
    
    try {
      // Test 1: Single file loading
      if (allFiles.length > 0) {
        const testFile = allFiles.find((f: FileData) => !f.isDirectory && !f.isContentLoaded);
        if (testFile) {
          log(`Test 1: Loading single file: ${testFile.name}`);
          const start = performance.now();
          await loadFileContent(testFile.path);
          const duration = performance.now() - start;
          log(`✓ Single file loaded in ${duration.toFixed(2)}ms`);
          
          // Check if token count was set
          const updatedFile = allFiles.find((f: FileData) => f.path === testFile.path);
          if (updatedFile?.tokenCount === undefined) {
            log('✗ Token count not set');
          } else {
            log(`✓ Token count: ${updatedFile.tokenCount}`);
          }
        }
      }
      
      // Test 2: Batch file loading
      const unloadedFiles = allFiles
        .filter((f: FileData) => !f.isDirectory && !f.isContentLoaded)
        .slice(0, 5);
      
      if (unloadedFiles.length > 0) {
        log(`Test 2: Batch loading ${unloadedFiles.length} files`);
        const start = performance.now();
        await loadMultipleFileContents(unloadedFiles.map((f: FileData) => f.path));
        const duration = performance.now() - start;
        log(`✓ Batch loaded in ${duration.toFixed(2)}ms`);
        
        // Check token counts
        const loadedCount = unloadedFiles.filter((f: FileData) => {
          const updated = allFiles.find((af: FileData) => af.path === f.path);
          return updated?.tokenCount !== undefined;
        }).length;
        log(`✓ ${loadedCount}/${unloadedFiles.length} files have token counts`);
      }
      
      // Test 3: File selection workflow
      const selectableFile = allFiles.find((f: FileData) => !f.isDirectory && f.isContentLoaded);
      if (selectableFile) {
        log(`Test 3: Testing file selection workflow`);
        
        // Toggle selection
        toggleFileSelection(selectableFile.path);
        
        // Check if file is in selected files
        const isSelected = selectedFiles.some((sf: SelectedFileWithLines) => sf.path === selectableFile.path);
        if (isSelected) {
          log('✓ File selection working correctly');
          const selected = selectedFiles.find((sf: SelectedFileWithLines) => sf.path === selectableFile.path);
          if (selected?.tokenCount !== undefined) {
            log(`✓ Selected file has token count: ${selected.tokenCount}`);
          }
        } else {
          log('✗ File selection failed');
        }
      }
      
      log('Integration tests completed!');
      
    } catch (error) {
      log(`Error during tests: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Component UI
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Web Worker Integration Test</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p>Worker Token Counting: <strong>{workerTokensEnabled ? 'ENABLED' : 'DISABLED'}</strong></p>
        <button
          onClick={() => FeatureControl.toggle()}
          style={{ marginRight: '10px' }}
        >
          Toggle Feature Flag
        </button>
        <button
          onClick={runIntegrationTests}
          disabled={isRunning || allFiles.length === 0}
        >
          {isRunning ? 'Running Tests...' : 'Run Integration Tests'}
        </button>
      </div>
      
      <div style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '10px', 
        borderRadius: '4px',
        maxHeight: '400px',
        overflow: 'auto'
      }}>
        <h3>Test Results:</h3>
        {testResults.length === 0 ? (
          <p>No tests run yet. Load a folder and click "Run Integration Tests".</p>
        ) : (
          <pre style={{ fontSize: '12px' }}>
            {testResults.join('\n')}
          </pre>
        )}
      </div>
      
      <div style={{ marginTop: '20px' }}>
        <h3>Current State:</h3>
        <ul>
          <li>Total files: {allFiles.length}</li>
          <li>Selected files: {selectedFiles.length}</li>
          <li>Files with content loaded: {allFiles.filter((f: FileData) => f.isContentLoaded).length}</li>
          <li>Files with token counts: {allFiles.filter((f: FileData) => f.tokenCount !== undefined).length}</li>
          <li>Files counting tokens: {allFiles.filter((f: FileData) => f.isCountingTokens).length}</li>
        </ul>
      </div>
    </div>
  );
};

export default WorkerIntegrationTest;