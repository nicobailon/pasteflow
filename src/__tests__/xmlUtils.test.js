/**
 * @jest-environment node
 */

const path = require('path');
const fs = require('fs').promises;
const { DOMParser } = require('@xmldom/xmldom');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockImplementation((path) => {
      if (path.includes('nonexistent')) {
        return Promise.reject(new Error('File not found'));
      }
      return Promise.resolve();
    }),
    rm: jest.fn().mockResolvedValue(undefined),
  }
}));

// Import the functions from xmlUtils
const {
  parseXmlString,
  preprocessXml,
  containsProblematicJsx,
  prepareXmlWithCdata,
  applyFileChanges,
  wrapFileCodeInCData,
  findProblemArea
} = require('../main/xmlUtils');

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
</changed_files`;
      
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
      await expect(parseXmlString(null)).rejects.toThrow(/Empty or null XML input/);
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
      const change = {
        file_summary: 'Create new file',
        file_operation: 'CREATE',
        file_path: 'src/components/NewFile.tsx',
        file_code: 'export default function NewFile() {}'
      };
      
      await applyFileChanges(change, projectDirectory);
      
      // Check that directory was created
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.dirname(path.join(projectDirectory, change.file_path)),
        { recursive: true }
      );
      
      // Check that file was written
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(projectDirectory, change.file_path),
        change.file_code,
        'utf8'
      );
    });
    
    test('should update an existing file', async () => {
      const change = {
        file_summary: 'Update existing file',
        file_operation: 'UPDATE',
        file_path: 'src/components/ExistingFile.tsx',
        file_code: 'export default function ExistingFile() {}'
      };
      
      await applyFileChanges(change, projectDirectory);
      
      // Check that file was written
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(projectDirectory, change.file_path),
        change.file_code,
        'utf8'
      );
    });
    
    test('should handle delete operation', async () => {
      const change = {
        file_summary: 'Delete file',
        file_operation: 'DELETE',
        file_path: 'src/components/OldFile.tsx'
      };
      
      await applyFileChanges(change, projectDirectory);
      
      // Check that file was deleted
      expect(fs.promises.rm).toHaveBeenCalledWith(
        path.join(projectDirectory, change.file_path),
        { force: true }
      );
    });
    
    test('should not throw when deleting a nonexistent file', async () => {
      const change = {
        file_summary: 'Delete nonexistent file',
        file_operation: 'DELETE',
        file_path: 'src/components/nonexistent.tsx'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).resolves.not.toThrow();
    });
    
    test('should throw when missing file_code for CREATE operation', async () => {
      const change = {
        file_summary: 'Create without code',
        file_operation: 'CREATE',
        file_path: 'src/components/MissingCode.tsx'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Missing file_code/);
    });
    
    test('should throw when project directory is not accessible', async () => {
      // Mock fs.access to throw EACCES error
      fs.promises.access.mockRejectedValueOnce({ code: 'EACCES', message: 'Permission denied' });
      
      const change = {
        file_summary: 'Create new file',
        file_operation: 'CREATE',
        file_path: 'src/components/NewFile.tsx',
        file_code: 'export default function NewFile() {}'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Permission denied/);
    });
    
    test('should throw when project directory does not exist', async () => {
      // Mock fs.access to throw ENOENT error
      fs.promises.access.mockRejectedValueOnce({ code: 'ENOENT', message: 'No such file or directory' });
      
      const change = {
        file_summary: 'Create new file',
        file_operation: 'CREATE',
        file_path: 'src/components/NewFile.tsx',
        file_code: 'export default function NewFile() {}'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/not accessible/);
    });
    
    test('should throw when updating a file without write permission', async () => {
      // First call to access succeeds (project directory check)
      fs.promises.access.mockResolvedValueOnce();
      // Second call to access fails (file permission check)
      fs.promises.access.mockRejectedValueOnce({ code: 'EACCES', message: 'Permission denied' });
      
      const change = {
        file_summary: 'Update existing file',
        file_operation: 'UPDATE',
        file_path: 'src/components/ExistingFile.tsx',
        file_code: 'export default function ExistingFile() {}'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/Permission denied/);
    });
    
    test('should throw when updating a nonexistent file', async () => {
      // First call to access succeeds (project directory check)
      fs.promises.access.mockResolvedValueOnce();
      // Second call to access fails (file existence check)
      fs.promises.access.mockRejectedValueOnce({ code: 'ENOENT', message: 'No such file or directory' });
      
      const change = {
        file_summary: 'Update nonexistent file',
        file_operation: 'UPDATE',
        file_path: 'src/components/NonexistentFile.tsx',
        file_code: 'export default function NonexistentFile() {}'
      };
      
      await expect(applyFileChanges(change, projectDirectory)).rejects.toThrow(/File not found/);
    });
    
    test('should sanitize file paths to prevent directory traversal', async () => {
      const change = {
        file_summary: 'Create file with potential traversal',
        file_operation: 'CREATE',
        file_path: '../../../etc/passwd',
        file_code: 'This should be sanitized'
      };
      
      await applyFileChanges(change, projectDirectory);
      
      // Check that the sanitized path was used
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(projectDirectory, 'etc/passwd'),
        change.file_code,
        'utf8'
      );
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
      expect(result).toContain('line:5');
      expect(result).toContain('>  5:');
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
      const errorMsg = 'Unknown error';
      const xml = `<changed_files>\n<file>\n<file_summary>Test</file_summary>\n<file_path>test.tsx</file_path>\n<file_code>\ncode\n</file_code>\n</file>\n</changed_files>`;
      
      const result = findProblemArea(xml, errorMsg);
      expect(result).toBeTruthy();
      // Should return a substring of the input
      expect(result.length).toBeLessThan(xml.length);
    });
  });
}); 