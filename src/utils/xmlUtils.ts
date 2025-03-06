import { DOMParser } from '@xmldom/xmldom';
import { FileChange } from '../types/FileTypes';

/**
 * Parse XML string containing file changes
 * @param xmlString XML string from the user
 * @returns Array of parsed file changes or null if parsing fails
 */
export function parseXmlString(xmlString: string): FileChange[] | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    
    // Find the changed_files node
    const changedFilesNode = doc.getElementsByTagName("changed_files")[0];
    if (!changedFilesNode) {
      console.error("No <changed_files> element found in XML");
      return null;
    }
    
    const fileNodes = changedFilesNode.getElementsByTagName("file");
    if (!fileNodes || fileNodes.length === 0) {
      console.error("No <file> elements found in <changed_files>");
      return null;
    }
    
    const changes: FileChange[] = [];
    
    for (let i = 0; i < fileNodes.length; i++) {
      const fileNode = fileNodes[i];
      
      // Get file_summary
      const summaryNodes = fileNode.getElementsByTagName("file_summary");
      const summary = summaryNodes.length > 0 ? summaryNodes[0].textContent || "" : "";
      
      // Get file_operation
      const operationNodes = fileNode.getElementsByTagName("file_operation");
      if (!operationNodes || operationNodes.length === 0) {
        console.error(`Missing file_operation for file at index ${i}`);
        continue;
      }
      const operation = operationNodes[0].textContent as 'CREATE' | 'UPDATE' | 'DELETE';
      
      // Get file_path
      const pathNodes = fileNode.getElementsByTagName("file_path");
      if (!pathNodes || pathNodes.length === 0) {
        console.error(`Missing file_path for file at index ${i}`);
        continue;
      }
      const path = pathNodes[0].textContent || "";
      
      // Get file_code (optional for DELETE operations)
      const codeNodes = fileNode.getElementsByTagName("file_code");
      const code = codeNodes.length > 0 ? codeNodes[0].textContent || "" : undefined;
      
      changes.push({
        summary,
        operation,
        path,
        code
      });
    }
    
    return changes;
  } catch (error) {
    console.error("Error parsing XML:", error);
    return null;
  }
}

/**
 * Format output with XML instructions
 * @param instructions XML instructions template
 * @param changes Array of file changes
 * @returns Formatted output string
 */
export function formatOutputWithXmlInstructions(instructions: string, changes: FileChange[]): string {
  if (!changes || changes.length === 0) {
    return "No changes to apply";
  }
  
  const summary = changes.map(change => {
    return `- ${change.operation} ${change.path}: ${change.summary}`;
  }).join('\n');
  
  return `${instructions}\n\nChanges to apply:\n${summary}`;
} 