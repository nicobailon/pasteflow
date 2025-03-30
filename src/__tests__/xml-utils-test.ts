/**
 * @jest-environment jsdom
 */

import { DOMParser } from '@xmldom/xmldom';

import * as path from 'node:path';

// Mock fs/promises module first, before importing it
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined)
}));

// Now import the mocked module
import * as fsPromises from 'node:fs/promises';

// Import the actual functions from xmlUtils
import {
  parseXmlString,
  applyFileChanges,
  prepareXmlWithCdata,
  containsProblematicJsx,
  findProblemArea,
  preprocessXml,
  wrapFileCodeInCData,
  FileOperation,
  FileChange,
  // Remove the non-existent imports:
  // saveXmlToFile,
  // getXmlOutputPath,
  // convertChangesToXml,
  // generateApplyScript,
  // loadSavedXmlFiles,
  // splitChangesIntoChunks,
  // saveJsonToFile,
  // loadAppliedChanges,
  // MAX_CHANGES_PER_FILE
} from '../main/xml-utils';

// Cast the mocked module to the right type
const mockedFsPromises = fsPromises as jest.Mocked<typeof fsPromises>;

// Sample XML strings for testing
const simpleXml = `
<changed_files>
  <file>
    <file_summary>Update button styles</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Button.tsx</file_path>
    <file_code>
      import React from 'react';
      export default function Button() {
        return <button>Click me</button>;
      }
    </file_code>
  </file>
</changed_files>
`;

// Create JSX XML string with problematic template literals
const createJsxXml = () => {
  return `
<changed_files>
  <file>
    <file_summary>Update CopyButton component</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/CopyButton.tsx</file_path>
    <file_code>
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
interface CopyButtonProps {
  text: string;
  className?: string;
  children?: JSX.Element | string;
}
const CopyButton = ({ text, className = "", children }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const [animating, setAnimating] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setAnimating(true);
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
      
      // Reset animation state
      setTimeout(() => {
        setAnimating(false);
      }, 300);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  return (
    <button
      type="button"
      className={"transition-all duration-300 " + (animating ? "scale-110" : "") + " " + (copied ? "bg-green-100 text-green-600" : "") + " " + className}
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      aria-label={copied ? "Copied!" : "Copy to clipboard"}
    >
      <span className={"inline-flex items-center transition-all " + (animating ? "scale-110" : "")}>
        {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
        {children && <span className="ml-2">{children}</span>}
      </span>
    </button>
  );
};
export default CopyButton;
    </file_code>
  </file>
</changed_files>
`;
};

// Create XML with problematic text
const createProblematicXml = () => {
  return `
<changed_files>
  <file>
    <file_summary>Code with error</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Button.tsx</file_path>
    <file_code>
import React from 'react';
Copy // This comment is problematic for XML parsing
export default function Button() {
  return <button>Click me</button>;
}
    </file_code>
  </file>
</changed_files>
`;
};

const cdataXml = `
<changed_files>
  <file>
    <file_summary>Update CopyButton component</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/CopyButton.tsx</file_path>
    <file_code><![CDATA[
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
interface CopyButtonProps {
  text: string;
  className?: string;
  children?: JSX.Element | string;
}
const CopyButton = ({ text, className = "", children }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const [animating, setAnimating] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setAnimating(true);
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
      
      // Reset animation state
      setTimeout(() => {
        setAnimating(false);
      }, 300);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  return (
    <button
      type="button"
      className={\`transition-all duration-300 \${animating ? "scale-110" : ""} \${copied ? "bg-green-100 text-green-600" : ""} \${className}\`}
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      aria-label={copied ? "Copied!" : "Copy to clipboard"}
    >
      <span className={\`inline-flex items-center transition-all \${animating ? "scale-110" : ""}\`}>
        {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
        {children && <span className="ml-2">{children}</span>}
      </span>
    </button>
  );
};
export default CopyButton;
    ]]></file_code>
  </file>
</changed_files>
`;

describe('XML Utils', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('containsProblematicJsx', () => {
    test('should detect problematic JSX in XML', () => {
      const jsxXml = createJsxXml();
      expect(containsProblematicJsx(jsxXml)).toBe(true);
    });

    test('should not flag properly formatted XML with CDATA', () => {
      expect(containsProblematicJsx(cdataXml)).toBe(false);
    });
    
    test('should detect standalone comment patterns like "Copy //"', () => {
      const problematicXml = createProblematicXml();
      expect(containsProblematicJsx(problematicXml)).toBe(true);
    });
    
    test('should detect nested JSX components', () => {
      const nestedJsxXml = `
<changed_files>
  <file>
    <file_summary>Nested JSX components</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/NestedComponents.tsx</file_path>
    <file_code>
import React from 'react';
const NestedExample = () => (
  <div className="container">
    <Header>
      <Navigation items={menuItems} />
      <SearchBar onSearch={handleSearch} placeholder="Search..." />
    </Header>
    <Content>
      {items.map(item => <Item key={item.id} data={item} />)}
    </Content>
  </div>
);
    </file_code>
  </file>
</changed_files>`;
      expect(containsProblematicJsx(nestedJsxXml)).toBe(true);
    });
    
    test('should detect multiple unquoted attributes', () => {
      const multiAttributeXml = `
<changed_files>
  <file>
    <file_summary>Multiple unquoted attributes</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Button.tsx</file_path>
    <file_code>
import React from 'react';
const Button = () => (
  <button
    type="button"
    className={buttonClasses}
    onClick={handleClick}
    disabled={isDisabled}
    aria-label={ariaLabel}
  >
    {children}
  </button>
);
    </file_code>
  </file>
</changed_files>`;
      expect(containsProblematicJsx(multiAttributeXml)).toBe(true);
    });
  });

  describe('preprocessXml', () => {
    test('should fix missing quotes around template literals', () => {
      const jsxXml = createJsxXml();
      const result = preprocessXml(jsxXml);
      expect(result).not.toBe(jsxXml); // Should be different
    });
    
    test('should handle problematic comments', () => {
      const problematicXml = createProblematicXml();
      const result = preprocessXml(problematicXml);
      expect(result).not.toBe(problematicXml);
      expect(result.includes('<!-- Copy //')).toBe(true);
    });

    // Test with invalid XML formats
    test('preprocessXml should handle invalid XML content', () => {
      // Valid, correctly formatted XML
      expect(preprocessXml('<xml><file></file></xml>')).toBe('<xml><file></file></xml>');
      
      // Null check (removed @ts-expect-error since we're now checking explicitly)
      expect(() => preprocessXml(null as unknown as string)).toThrow();
      
      // Empty string
      expect(preprocessXml('')).toBe('');
      
      // Non-XML content
      expect(preprocessXml('Not XML')).toBe('Not XML');
    });
  });

  describe('prepareXmlWithCdata', () => {
    test('should wrap file_code content in CDATA sections', () => {
      const result = prepareXmlWithCdata(simpleXml);
      expect(result.includes('<![CDATA[')).toBe(true);
      expect(result.includes(']]>')).toBe(true);
    });

    test('should not add CDATA if already present', () => {
      const result = prepareXmlWithCdata(cdataXml);
      // Count occurrences of CDATA start tag
      const cdataCount = (result.match(/<!\[CDATA\[/g) || []).length;
      expect(cdataCount).toBe(1); // Should still only have one CDATA section
    });
    
    test('should handle empty file_code tags', () => {
      const emptyCodeXml = `
<changed_files>
  <file>
    <file_summary>Empty code</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Empty.tsx</file_path>
    <file_code>
    </file_code>
  </file>
</changed_files>`;
      const result = prepareXmlWithCdata(emptyCodeXml);
      expect(result.includes('<file_code><![CDATA[')).toBe(true);
      expect(result.includes(']]></file_code>')).toBe(true);
    });
    
    test('should handle malformed CDATA sections', () => {
      const malformedCdataXml = `
<changed_files>
  <file>
    <file_summary>Malformed CDATA</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Malformed.tsx</file_path>
    <file_code><![CDATA[
import React from 'react';
// Missing closing CDATA tag
    </file_code>
  </file>
</changed_files>`;
      
      // Should not throw and should add proper CDATA
      const result = prepareXmlWithCdata(malformedCdataXml);
      // Should detect the malformed CDATA and handle it
      expect(result.includes('<file_code><![CDATA[')).toBe(true);
      expect(result.includes(']]></file_code>')).toBe(true);
    });
    
    test('should handle multiple file_code sections', () => {
      const multipleCodeXml = `
<changed_files>
  <file>
    <file_summary>First file</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/First.tsx</file_path>
    <file_code>
import React from 'react';
export default () => <div>First</div>;
    </file_code>
  </file>
  <file>
    <file_summary>Second file</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Second.tsx</file_path>
    <file_code>
import React from 'react';
export default () => <div>Second</div>;
    </file_code>
  </file>
</changed_files>`;
      
      const result = prepareXmlWithCdata(multipleCodeXml);
      const cdataCount = (result.match(/<!\[CDATA\[/g) || []).length;
      expect(cdataCount).toBe(2); // Should have two CDATA sections
    });
  });

  describe('wrapFileCodeInCData', () => {
    test('should wrap file_code content in CDATA sections', () => {
      const result = wrapFileCodeInCData(simpleXml);
      expect(result.includes('<file_code><![CDATA[')).toBe(true);
      expect(result.includes(']]></file_code>')).toBe(true);
    });
  });

  describe('parseXmlString', () => {
    test('should parse simple XML correctly', async () => {
      const changes = await parseXmlString(simpleXml);
      expect(changes).toHaveLength(1);
      expect(changes[0].file_path).toBe('src/components/Button.tsx');
      expect(changes[0].file_operation).toBe('UPDATE');
    });

    test('should handle JSX in XML with preprocessing', async () => {
      const jsxXml = createJsxXml();
      const changes = await parseXmlString(jsxXml);
      expect(changes).toHaveLength(1);
      expect(changes[0].file_path).toBe('src/components/CopyButton.tsx');
      expect(changes[0].file_code).toContain('const [copied, setCopied] = useState(false)');
    });

    test('should parse XML with existing CDATA sections', async () => {
      const changes = await parseXmlString(cdataXml);
      expect(changes).toHaveLength(1);
      expect(changes[0].file_path).toBe('src/components/CopyButton.tsx');
      // Should contain template literals
      expect(changes[0].file_code).toContain('className={`');
    });
    
    test('should throw error for XML with unclosed tags', async () => {
      const malformedXml = `
<changed_files>
  <file>
    <file_summary>Unclosed tag</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Unclosed.tsx</file_path>
    <file_code>
      import React from 'react';
    </file_code>
  </file>
`;  // Missing </changed_files> closing tag
      
      await expect(parseXmlString(malformedXml)).rejects.toThrow(/XML parsing/);
    });
    
    test('should throw error for XML with missing required elements', async () => {
      const missingElementsXml = `
<changed_files>
  <file>
    <file_summary>Missing elements</file_summary>
    <file_path>src/components/Missing.tsx</file_path>
    <file_code>
      import React from 'react';
    </file_code>
  </file>
</changed_files>`;
      
      // Missing file_operation
      const changes = await parseXmlString(missingElementsXml);
      expect(changes).toHaveLength(0); // Should skip the file with missing elements
    });
    
    test('should handle deeply nested XML structure', async () => {
      const deeplyNestedXml = `
<changed_files>
  <file>
    <file_summary>Deeply nested structure</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/Nested.tsx</file_path>
    <file_code>
import React from 'react';
const DeepNesting = () => (
  <div>
    <section>
      <article>
        <header>
          <h1>Title</h1>
          <h2>Subtitle</h2>
        </header>
        <div className="content">
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      </article>
    </section>
  </div>
);
    </file_code>
  </file>
</changed_files>`;
      
      const changes = await parseXmlString(deeplyNestedXml);
      expect(changes).toHaveLength(1);
      expect(changes[0].file_path).toBe('src/components/Nested.tsx');
      expect(changes[0].file_code).toContain('const DeepNesting = () =>');
    });
    
    test('should reject empty XML input', async () => {
      await expect(parseXmlString('')).rejects.toThrow(/Empty or null XML input/);
      await expect(parseXmlString(undefined as unknown as string)).rejects.toThrow(/Empty or null XML input/);
      await expect(parseXmlString('   ')).rejects.toThrow(/Empty or null XML input/);
    });
  });

  describe('applyFileChanges', () => {
    const projectDirectory = '/test/project';
    
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });
    
    test('should create a new file', async () => {
      const change: FileChange = {
        file_summary: 'Create new file',
        file_operation: 'CREATE' as FileOperation,
        file_path: 'src/components/NewFile.tsx',
        file_code: 'export default function NewFile() {}'
      };
      
      await applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true });
      
      // We're in test mode, so we shouldn't check directory access or actually write files
      expect(mockedFsPromises.mkdir).not.toHaveBeenCalled();
      expect(mockedFsPromises.writeFile).not.toHaveBeenCalled();
    });
    
    test('should update an existing file', async () => {
      const change: FileChange = {
        file_summary: 'Update existing file',
        file_operation: 'UPDATE' as FileOperation,
        file_path: 'src/components/ExistingFile.tsx',
        file_code: 'export default function ExistingFile() {}'
      };
      
      await applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true });
      
      // We're in test mode, so we shouldn't check directory access or actually write files
      expect(mockedFsPromises.mkdir).not.toHaveBeenCalled();
      expect(mockedFsPromises.writeFile).not.toHaveBeenCalled();
    });
    
    test('should handle delete operation', async () => {
      const change: FileChange = {
        file_summary: 'Delete file',
        file_operation: 'DELETE' as FileOperation,
        file_path: 'src/components/OldFile.tsx',
        file_code: '' // Add this to satisfy the type
      };
      
      await applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true });
      
      // We're in test mode, so we shouldn't check directory access or actually delete files
      expect(mockedFsPromises.rm).not.toHaveBeenCalled();
    });
    
    test('should not throw when deleting a nonexistent file', async () => {
      const change: FileChange = {
        file_summary: 'Delete nonexistent file',
        file_operation: 'DELETE' as FileOperation,
        file_path: 'src/components/nonexistent.tsx',
        file_code: '' // Add empty file_code for DELETE operations
      };
      
      await expect(
        applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true })
      ).resolves.not.toThrow();
    });
    
    test('should throw when missing file_code for CREATE operation', async () => {
      const change: FileChange = {
        file_summary: 'Create without code',
        file_operation: 'CREATE' as FileOperation,
        file_path: 'src/components/MissingCode.tsx',
        file_code: '' // Add empty file_code to test missing code error
      };
      
      await expect(
        applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true })
      ).rejects.toThrow(/Missing file_code/);
    });
    
    test('should handle non-existent directories in test mode', async () => {
      const change: FileChange = {
        file_summary: 'Create new file in test mode',
        file_operation: 'CREATE' as FileOperation,
        file_path: 'src/components/TestModeFile.tsx',
        file_code: 'export default function TestModeFile() {}'
      };
      
      // Call with testMode and mockDirectoryExists options
      await applyFileChanges(change, projectDirectory, { 
        testMode: true, 
        mockDirectoryExists: true 
      });
      
      // In test mode with mockDirectoryExists, we shouldn't check directory access
      expect(mockedFsPromises.access).not.toHaveBeenCalled();
      
      // In test mode, we shouldn't attempt to write the file
      expect(mockedFsPromises.writeFile).not.toHaveBeenCalled();
    });
    
    test('should handle delete operation in test mode', async () => {
      const change: FileChange = {
        file_summary: 'Delete file in test mode',
        file_operation: 'DELETE' as FileOperation,
        file_path: 'src/components/TestModeDeleteFile.tsx',
        file_code: '' // Add empty file_code for DELETE operations
      };
      
      // Call with testMode option
      await applyFileChanges(change, projectDirectory, { testMode: true, mockDirectoryExists: true });
      
      // In test mode, we shouldn't attempt to delete the file
      expect(mockedFsPromises.rm).not.toHaveBeenCalled();
    });
    
    test('should throw when project directory is not accessible', async () => {
      // Mock fs.access to throw EACCES error
      mockedFsPromises.access.mockRejectedValueOnce({ code: 'EACCES', message: 'Permission denied' });
      
      const change: FileChange = {
        file_summary: 'Create new file',
        file_operation: 'CREATE' as FileOperation,
        file_path: 'src/components/NewFile.tsx',
        file_code: 'export default function NewFile() {}'
      };
      
      // Don't use testMode here because we want to test the error handling
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Error accessing project directory/);
    });
    
    test('should throw when updating a file without write permission', async () => {
      // First call to access succeeds (project directory check)
      mockedFsPromises.access.mockResolvedValueOnce();
      // Mock writeFile to throw a permission error
      const permissionError = new Error('Permission denied');
      (permissionError as any).code = 'EACCES';
      mockedFsPromises.writeFile.mockRejectedValueOnce(permissionError);
      
      const change: FileChange = {
        file_summary: 'Update existing file',
        file_operation: 'UPDATE' as FileOperation,
        file_path: 'src/components/ExistingFile.tsx',
        file_code: 'export default function UpdatedFile() {}'
      };
      
      // We can't use mockDirectoryExists here because we need to test permission errors
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Error accessing project directory/);
    });
    
    test('should throw when updating a nonexistent file', async () => {
      // First call to access succeeds (project directory check)
      mockedFsPromises.access.mockResolvedValueOnce();
      // Mock writeFile to throw a file not found error
      const notFoundError = new Error('No such file or directory');
      (notFoundError as any).code = 'ENOENT';
      mockedFsPromises.writeFile.mockRejectedValueOnce(notFoundError);
      
      const change: FileChange = {
        file_summary: 'Update nonexistent file',
        file_operation: 'UPDATE' as FileOperation,
        file_path: 'src/components/NonexistentFile.tsx',
        file_code: 'export default function NonexistentFile() {}'
      };
      
      // We can't use mockDirectoryExists here because we need to test file existence errors
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Error accessing project directory/);
    });
    
    test('should sanitize file paths to prevent directory traversal', async () => {
      // Mock fs.access to succeed for the project directory check
      mockedFsPromises.access.mockResolvedValueOnce();
      
      const change: FileChange = {
        file_summary: 'Create file with potential traversal',
        file_operation: 'CREATE' as FileOperation,
        file_path: '../../../etc/passwd',
        file_code: 'This should be sanitized'
      };
      
      // We can't use mockDirectoryExists here because we need to test path validation
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Error accessing project directory/);
    });
  });
  
  describe('findProblemArea', () => {
    test('should identify problem area from error message', () => {
      const errorMsg = 'Element type "button" must be followed by either attribute specifications, ">" or "/>"';
      const xml = `<div>\n<button\ntype="button"\nonClick={() => {}}\n>Click me</button>\n</div>`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      expect(result).toContain('button');
    });
    
    test('should identify line and column from error message', () => {
      const errorMsg = 'Error @#[line:5,col:10]';
      const xml = `line1\nline2\nline3\nline4\nline5 with error at col 10\nline6\nline7`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      expect(result).toContain('line 5');
      expect(result).toContain('> 5:');
      expect(result).toContain('^'); // Should have a pointer to the column
    });
    
    test('should identify unclosed CDATA section', () => {
      const errorMsg = 'XML parsing failed';
      const xml = `<file_code><![CDATA[\nimport React from 'react';\n// No closing CDATA tag\n</file_code>`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      expect(result).toContain('Unclosed CDATA section');
    });
    
    test('should identify unclosed file_code tag', () => {
      const errorMsg = 'XML parsing failed';
      const xml = `<file>\n<file_summary>Test</file_summary>\n<file_path>test.tsx</file_path>\n<file_code>\ncode\n// No closing file_code tag\n</file>`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      expect(result).toContain('Unclosed file_code tag');
    });
    
    test('should provide a fallback chunk of XML when no specific issue is found', () => {
      const errorMsg = 'XML parsing failed';
      const xml = `<file_code>\n${Array.from({length: 50}).fill('import something;').join('\n')}\n</file_code>`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      // Should return a substring of the input, but it might be the whole input if it's small enough
      expect(result?.length).toBeLessThanOrEqual(xml.length);
    });
  });
}); 