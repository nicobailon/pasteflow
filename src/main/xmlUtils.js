const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs").promises;
const path = require("path");

/**
 * Parse XML string containing file changes
 * @param {string} xmlString XML string from o1 model
 * @returns {Promise<Array<{file_summary: string, file_operation: string, file_path: string, file_code?: string}> | null>} Array of parsed file changes or null if parsing fails
 */
async function parseXmlString(xmlString) {
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
    
    const changes = [];
    
    for (let i = 0; i < fileNodes.length; i++) {
      const fileNode = fileNodes[i];
      
      // Get file_summary
      const summaryNodes = fileNode.getElementsByTagName("file_summary");
      const file_summary = summaryNodes.length > 0 ? summaryNodes[0].textContent || "" : "";
      
      // Get file_operation
      const operationNodes = fileNode.getElementsByTagName("file_operation");
      if (!operationNodes || operationNodes.length === 0) {
        console.error(`Missing file_operation for file at index ${i}`);
        continue;
      }
      const file_operation = operationNodes[0].textContent || "";
      
      // Get file_path
      const pathNodes = fileNode.getElementsByTagName("file_path");
      if (!pathNodes || pathNodes.length === 0) {
        console.error(`Missing file_path for file at index ${i}`);
        continue;
      }
      const file_path = pathNodes[0].textContent || "";
      
      // Get file_code (optional for DELETE operations)
      const codeNodes = fileNode.getElementsByTagName("file_code");
      const file_code = codeNodes.length > 0 ? codeNodes[0].textContent || "" : undefined;
      
      changes.push({
        file_summary,
        file_operation,
        file_path,
        file_code
      });
    }
    
    return changes;
  } catch (error) {
    console.error("Error parsing XML:", error);
    return null;
  }
}

/**
 * Apply file changes to the project directory
 * @param {Object} change Parsed file change object
 * @param {string} change.file_summary Description of the change
 * @param {string} change.file_operation Operation type (CREATE, UPDATE, DELETE)
 * @param {string} change.file_path Path to the file relative to project directory
 * @param {string} [change.file_code] File content (required for CREATE and UPDATE)
 * @param {string} projectDirectory Target directory path
 * @returns {Promise<void>}
 */
async function applyFileChanges(change, projectDirectory) {
  const fullPath = path.join(projectDirectory, change.file_path);
  
  switch (change.file_operation.toUpperCase()) {
    case "CREATE":
    case "UPDATE":
      if (!change.file_code) {
        throw new Error(`Missing file_code for ${change.file_operation} operation on ${change.file_path}`);
      }
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file content
      await fs.writeFile(fullPath, change.file_code, "utf8");
      break;
      
    case "DELETE":
      // Check if file exists before attempting to delete
      try {
        await fs.access(fullPath);
        await fs.rm(fullPath, { force: true });
      } catch (error) {
        // If file doesn't exist, log a warning but don't throw an error
        console.warn(`File ${fullPath} does not exist for DELETE operation`);
      }
      break;
      
    default:
      throw new Error(`Unknown file operation: ${change.file_operation}`);
  }
}

module.exports = {
  parseXmlString,
  applyFileChanges
}; 