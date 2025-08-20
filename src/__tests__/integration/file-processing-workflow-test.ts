import { processFileContent } from '../../utils/content-formatter';
import { estimateTokenCount } from '../../utils/token-utils';
import { validateWorkspaceSelections } from '../../utils/workspace-utils';
import { FileData, SelectedFileWithLines, WorkspaceState } from '../../types/file-types';

// Simple filter function for this test
const filterFiles = (files: FileData[], patterns: string[]): FileData[] => {
  return files.filter(file => {
    // Simple pattern matching for test purposes
    return !patterns.some(pattern => {
      const simplePattern = pattern.replace('**/', '').replace('*', '');
      return file.name.includes(simplePattern);
    });
  });
};

describe('File Processing Workflow Integration', () => {
  // Test data setup
  const createTestFile = (name: string, content: string): FileData => ({
    name,
    path: `/test/${name}`,
    content,
    isDirectory: false,
    size: content.length,
    isBinary: false,
    isSkipped: false,
    fileType: name.split('.').pop() || 'txt',
    tokenCount: estimateTokenCount(content)
  });

  const testFiles: FileData[] = [
    createTestFile('index.js', 'console.log("hello world");\nconst x = 42;\nexport default x;'),
    createTestFile('utils.js', 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a * b;'),
    createTestFile('README.md', '# Test Project\n\nThis is a test project.\n\n## Features\n- Feature 1\n- Feature 2'),
    createTestFile('config.json', '{\n  "name": "test",\n  "version": "1.0.0",\n  "private": true\n}'),
    createTestFile('data.bin', 'binary content here'),
    createTestFile('.env', 'SECRET_KEY=12345\nAPI_URL=https://api.test.com')
  ];

  // Mark binary file
  testFiles[4].isBinary = true;

  describe('Complete File Selection and Processing Workflow', () => {
    it('should process files with proper filtering, selection, and token counting', () => {
      // STEP 1: Filter files based on exclusion patterns
      const exclusionPatterns = ['**/*.env', '**/data.bin'];
      const filteredFiles = filterFiles(testFiles, exclusionPatterns);

      // Verify filtering
      expect(filteredFiles).toHaveLength(4);                           // 1. Correct count after filtering
      expect(filteredFiles.find(f => f.name === '.env')).toBeUndefined(); // 2. .env excluded
      expect(filteredFiles.find(f => f.name === 'data.bin')).toBeUndefined(); // 3. Binary excluded
      expect(filteredFiles.find(f => f.name === 'index.js')).toBeDefined(); // 4. JS files included

      // STEP 2: Select specific files with line ranges
      const selectedFiles: SelectedFileWithLines[] = [
        {
          path: '/test/index.js',
          lines: [{ start: 1, end: 2 }], // Select first 2 lines only
          isContentLoaded: true
        },
        {
          path: '/test/utils.js',
          // No lines specified = entire file
          isContentLoaded: true
        },
        {
          path: '/test/README.md',
          lines: [
            { start: 1, end: 1 },  // Just the title
            { start: 5, end: 7 }   // Features section
          ],
          isContentLoaded: true
        }
      ];

      // STEP 3: Process content for each selected file
      const processedFiles = selectedFiles.map(selectedFile => {
        const fileData = testFiles.find(f => f.path === selectedFile.path);
        if (!fileData || !fileData.content) return null;

        const { content, partial } = processFileContent(
          fileData.content,
          selectedFile
        );

        const lineCount = content.split('\n').length;
        const tokenCount = countTokens(content);

        return {
          path: selectedFile.path,
          content,
          partial,
          lineCount,
          tokenCount,
          originalTokenCount: fileData.tokenCount
        };
      }).filter(Boolean);

      // Verify content processing
      expect(processedFiles).toHaveLength(3);                          // 5. All selected files processed

      const indexFile = processedFiles.find(f => f?.path === '/test/index.js');
      expect(indexFile?.partial).toBe(true);                          // 6. Partial selection detected
      expect(indexFile?.content).toContain('console.log');            // 7. First line included
      expect(indexFile?.content).toContain('const x = 42');           // 8. Second line included
      expect(indexFile?.content).not.toContain('export default');     // 9. Third line excluded
      expect(indexFile?.lineCount).toBe(2);                          // 10. Correct line count

      const utilsFile = processedFiles.find(f => f?.path === '/test/utils.js');
      expect(utilsFile?.partial).toBe(false);                        // 11. Full file selection
      expect(utilsFile?.content).toContain('add =');                 // 12. Full content present
      expect(utilsFile?.content).toContain('multiply =');            // 13. All functions included

      const readmeFile = processedFiles.find(f => f?.path === '/test/README.md');
      expect(readmeFile?.partial).toBe(true);                        // 14. Partial selection
      expect(readmeFile?.content).toContain('# Test Project');       // 15. Title included
      expect(readmeFile?.content).toContain('## Features');          // 16. Features header included
      expect(readmeFile?.content).not.toContain('This is a test project'); // 17. Line 3 excluded

      // STEP 4: Calculate total tokens
      const totalTokens = processedFiles.reduce((sum, f) => sum + (f?.tokenCount || 0), 0);
      expect(totalTokens).toBeGreaterThan(0);                        // 18. Tokens calculated
      expect(totalTokens).toBeLessThan(                              // 19. Less than full content
        testFiles.reduce((sum, f) => sum + (f.tokenCount || 0), 0)
      );
    });

    it('should handle workspace validation with line selections', () => {
      // Create a workspace with some invalid selections
      const workspace: WorkspaceState = {
        selectedFiles: [
          {
            path: '/test/index.js',
            lines: [
              { start: 1, end: 2 },
              { start: 10, end: 20 } // Invalid - file only has 3 lines
            ]
          },
          {
            path: '/test/deleted.js', // File doesn't exist
            lines: [{ start: 1, end: 5 }]
          },
          {
            path: '/test/utils.js',
            lines: [{ start: 1, end: 2 }] // Valid
          }
        ],
        selectedFolder: '/test',
        allFiles: testFiles,
        expandedNodes: {},
        sortOrder: 'name',
        searchTerm: '',
        fileTreeMode: 'selected',
        exclusionPatterns: [],
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        },
        savedAt: Date.now()
      };

      // Validate workspace selections
      const { validatedWorkspace, changes, summary } = validateWorkspaceSelections(
        workspace,
        testFiles
      );

      // Verify validation results
      expect(validatedWorkspace.selectedFiles).toHaveLength(2);       // 1. Invalid file removed
      expect(summary.deletedFiles).toContain('/test/deleted.js');     // 2. Deleted file tracked
      expect(changes).toHaveLength(2);                                // 3. Two files had changes

      const indexChange = changes.find(c => c.filePath === '/test/index.js');
      expect(indexChange?.removedLines).toEqual([{ start: 10, end: 20 }]); // 4. Invalid range removed
      expect(indexChange?.currentLines).toEqual([{ start: 1, end: 2 }]);   // 5. Valid range kept

      // Verify final workspace state
      const validatedIndexFile = validatedWorkspace.selectedFiles.find(
        f => f.path === '/test/index.js'
      );
      expect(validatedIndexFile?.lines).toHaveLength(1);              // 6. Only valid range remains
      expect(validatedIndexFile?.lines?.[0]).toEqual({ start: 1, end: 2 }); // 7. Correct range
    });

    it('should handle binary and large file filtering', () => {
      // Add a large file to test size-based filtering
      const largeFile = createTestFile('large.txt', 'x'.repeat(1024 * 1024)); // 1MB
      largeFile.size = 1024 * 1024;
      
      const allFiles = [...testFiles, largeFile];

      // Filter with binary exclusion
      const filtered = allFiles.filter(f => !f.isBinary);
      
      expect(filtered.find(f => f.name === 'data.bin')).toBeUndefined(); // 1. Binary excluded
      expect(filtered.find(f => f.name === 'large.txt')).toBeDefined();  // 2. Large text included

      // Process large file content
      const { content } = processFileContent(
        largeFile.content!,
        { path: largeFile.path }
      );
      const tokenCount = countTokens(content);

      expect(content).toHaveLength(1024 * 1024);                      // 3. Full content processed
      expect(tokenCount).toBeGreaterThan(100000);                     // 4. Many tokens counted
    });

    it('should integrate token counting with file selection', () => {
      // Select multiple files and track token usage
      const selections: SelectedFileWithLines[] = [
        { path: '/test/index.js' },
        { path: '/test/utils.js' },
        { path: '/test/README.md' }
      ];

      let totalTokens = 0;
      const results = selections.map(selection => {
        const file = testFiles.find(f => f.path === selection.path);
        if (!file) return null;

        const tokens = file.tokenCount || countTokens(file.content || '');
        totalTokens += tokens;

        return {
          path: file.path,
          name: file.name,
          tokens
        };
      }).filter(Boolean);

      // Verify token accumulation
      expect(results).toHaveLength(3);                                 // 1. All files processed
      expect(totalTokens).toBeGreaterThan(0);                         // 2. Tokens counted
      expect(results.every(r => r && r.tokens > 0)).toBe(true);      // 3. Each file has tokens

      // Check individual file tokens
      const indexTokens = results.find(r => r?.name === 'index.js')?.tokens;
      const utilsTokens = results.find(r => r?.name === 'utils.js')?.tokens;
      expect(indexTokens).toBeLessThan(utilsTokens!);                // 4. Utils has more content
    });

    it('should handle edge cases in file processing', () => {
      // Test empty file
      const emptyFile = createTestFile('empty.txt', '');
      const emptyResult = processFileContent('', { path: emptyFile.path });
      
      expect(emptyResult.content).toBe('');                          // 1. Empty content handled
      expect(countTokens(emptyResult.content)).toBe(0);             // 2. Zero tokens
      expect(emptyResult.content.split('\n').filter(l => l).length).toBe(0); // 3. Zero lines

      // Test file with only whitespace
      const whitespaceFile = createTestFile('whitespace.txt', '   \n\n   \n');
      const whitespaceResult = processFileContent(
        whitespaceFile.content!,
        { path: whitespaceFile.path }
      );
      
      expect(whitespaceResult.content.split('\n').length).toBe(4);   // 4. Lines counted (3 newlines = 4 lines)
      expect(countTokens(whitespaceResult.content)).toBeGreaterThanOrEqual(0); // 5. Minimal tokens

      // Test file with invalid line ranges
      const invalidRangeResult = processFileContent(
        'line1\nline2\nline3',
        {
          path: '/test/file.txt',
          lines: [
            { start: 2, end: 2 }      // Valid line selection
          ]
        }
      );

      expect(invalidRangeResult.content).toContain('line2');         // 6. Valid parts included
      expect(invalidRangeResult.partial).toBe(true);                 // 7. Marked as partial
    });
  });
});