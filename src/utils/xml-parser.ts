import { DOMParser } from '@xmldom/xmldom';

export interface FileChange {
  summary: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  path: string;
  code?: string;
}

/**
 * Parse XML content for file changes
 * @param xmlContent The XML content to parse
 * @returns An array of file changes
 */
export function parseXmlChanges(xmlContent: string): FileChange[] {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
    
    // Use getElementsByTagName which works with DOM interfaces
    const fileNodes = xmlDoc.getElementsByTagName('file');
    const changes: FileChange[] = [];
    
    for (let i = 0; i < fileNodes.length; i++) {
      const fileNode = fileNodes[i];
      
      // Get file summary
      const summaryNodes = fileNode.getElementsByTagName('file_summary');
      const summary = summaryNodes.length > 0 ? summaryNodes[0].textContent || '' : '';
      
      // Get file operation
      const operationNodes = fileNode.getElementsByTagName('file_operation');
      const operation = operationNodes.length > 0 ? 
        operationNodes[0].textContent as 'CREATE' | 'UPDATE' | 'DELETE' : 'UPDATE';
      
      // Get file path
      const pathNodes = fileNode.getElementsByTagName('file_path');
      const path = pathNodes.length > 0 ? pathNodes[0].textContent || '' : '';
      
      // Get file code (if not DELETE operation)
      let code: string | undefined;
      if (operation !== 'DELETE') {
        const codeNodes = fileNode.getElementsByTagName('file_code');
        code = codeNodes.length > 0 ? codeNodes[0].textContent || '' : '';
      }
      
      // Add to changes array
      changes.push({
        summary,
        operation,
        path,
        code
      });
    }
    
    return changes;
  } catch (error) {
    console.error('Error parsing XML:', error);
    throw new Error(`Failed to parse XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate XML content for file changes
 * @param xmlContent The XML content to validate
 * @returns An object with validation result and optional error message
 */
export function validateXmlChanges(xmlContent: string): { isValid: boolean; error?: string } {
  try {
    const changes = parseXmlChanges(xmlContent);
    
    // Check if there are any changes
    if (changes.length === 0) {
      return { isValid: false, error: 'No file changes found in XML' };
    }
    
    // Validate each change
    for (const change of changes) {
      // Check required fields
      if (!change.operation) {
        return { isValid: false, error: `Missing operation for file: ${change.path}` };
      }
      
      if (!change.path) {
        return { isValid: false, error: 'Missing file path for a change' };
      }
      
      // Check if code is provided for CREATE and UPDATE operations
      if ((change.operation === 'CREATE' || change.operation === 'UPDATE') && !change.code) {
        return { isValid: false, error: `Missing code for ${change.operation} operation on file: ${change.path}` };
      }
    }
    
    return { isValid: true };
  } catch (error) {
    return { 
      isValid: false, 
      error: `XML validation failed: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

/**
 * Generate a summary of changes from parsed XML
 * @param changes Array of file changes
 * @returns A summary string
 */
export function generateChangesSummary(changes: FileChange[]): string {
  if (changes.length === 0) {
    return 'No changes to apply';
  }
  
  const createCount = changes.filter(c => c.operation === 'CREATE').length;
  const updateCount = changes.filter(c => c.operation === 'UPDATE').length;
  const deleteCount = changes.filter(c => c.operation === 'DELETE').length;
  
  return [
    `Total changes: ${changes.length}`,
    createCount > 0 ? `${createCount} file${createCount === 1 ? '' : 's'} to create` : '',
    updateCount > 0 ? `${updateCount} file${updateCount === 1 ? '' : 's'} to update` : '',
    deleteCount > 0 ? `${deleteCount} file${deleteCount === 1 ? '' : 's'} to delete` : ''
  ].filter(Boolean).join(', ');
} 