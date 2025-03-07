import { parseXmlChanges, validateXmlChanges, generateChangesSummary } from '../utils/xmlParser';

// Mock XML content for testing
const testXml = `
<changed_files>
  <file>
    <file_summary>Update SearchBar component with improved accessibility and styling</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/SearchBar.tsx</file_path>
    <file_code>
      // Mock code content for SearchBar component
      import React from "react";
      // More code here
    </file_code>
  </file>
  <file>
    <file_summary>Create new utility functions for date formatting</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/utils/dateFormatter.ts</file_path>
    <file_code>
      // Mock code content for date formatter
      export function formatDate(date) {
        return date.toLocaleDateString();
      }
      // More code here
    </file_code>
  </file>
  <file>
    <file_summary>Update CopyButton component with improved accessibility</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/CopyButton.tsx</file_path>
    <file_code>
      // Mock code content for CopyButton component
      import React from "react";
      // More code here
    </file_code>
  </file>
  <file>
    <file_summary>Create new Toast notification component</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/components/Toast.tsx</file_path>
    <file_code>
      // Mock code content for Toast component
      import React from "react";
      // More code here
    </file_code>
  </file>
  <file>
    <file_summary>Delete deprecated component</file_summary>
    <file_operation>DELETE</file_operation>
    <file_path>src/components/OldComponent.tsx</file_path>
  </file>
</changed_files>
`;

describe('XML Parser', () => {
  test('parseXmlChanges should parse XML correctly', () => {
    const changes = parseXmlChanges(testXml);
    
    // Check if all files are parsed
    expect(changes.length).toBe(5);
    
    // Check the first file (UPDATE operation)
    expect(changes[0]).toEqual({
      summary: 'Update SearchBar component with improved accessibility and styling',
      operation: 'UPDATE',
      path: 'src/components/SearchBar.tsx',
      code: expect.stringContaining('Mock code content for SearchBar')
    });
    
    // Check the second file (CREATE operation)
    expect(changes[1]).toEqual({
      summary: 'Create new utility functions for date formatting',
      operation: 'CREATE',
      path: 'src/utils/dateFormatter.ts',
      code: expect.stringContaining('export function formatDate')
    });
    
    // Check the last file (DELETE operation)
    expect(changes[4]).toEqual({
      summary: 'Delete deprecated component',
      operation: 'DELETE',
      path: 'src/components/OldComponent.tsx',
      code: undefined
    });
  });
  
  test('validateXmlChanges should validate valid XML', () => {
    const result = validateXmlChanges(testXml);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });
  
  test('validateXmlChanges should reject invalid XML', () => {
    const invalidXml = '<changed_files><file><file_summary>Invalid</file_summary></file></changed_files>';
    const result = validateXmlChanges(invalidXml);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });
  
  test('validateXmlChanges should reject XML with missing code for CREATE operation', () => {
    const invalidXml = `
      <changed_files>
        <file>
          <file_summary>Missing code</file_summary>
          <file_operation>CREATE</file_operation>
          <file_path>src/test.ts</file_path>
        </file>
      </changed_files>
    `;
    const result = validateXmlChanges(invalidXml);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Missing code for CREATE operation');
  });
  
  test('generateChangesSummary should generate correct summary', () => {
    const changes = parseXmlChanges(testXml);
    const summary = generateChangesSummary(changes);
    
    expect(summary).toContain('Total changes: 5');
    expect(summary).toContain('2 files to create');
    expect(summary).toContain('2 files to update');
    expect(summary).toContain('1 file to delete');
  });
  
  test('generateChangesSummary should handle empty changes array', () => {
    const summary = generateChangesSummary([]);
    expect(summary).toBe('No changes to apply');
  });
}); 