"use server";

import { applyFileChanges } from "../lib/apply-changes";
import { parseXmlString } from "../src/main/xml-utils";

export async function applyChangesAction(xml: string, projectDirectory: string) {
  try {
    if (!xml || xml.trim() === '') {
      throw new Error("XML content is empty. Please provide valid XML.");
    }

    const changes = await parseXmlString(xml);

    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      throw new Error("No valid file changes found in the XML. Please check the XML format.");
    }

    const finalDirectory = projectDirectory && projectDirectory.trim() !== "" 
      ? projectDirectory.trim() 
      : process.env.PROJECT_DIRECTORY;

    if (!finalDirectory) {
      throw new Error("No project directory provided and no fallback found in environment variables.");
    }

    console.log(`Applying ${changes.length} file changes to directory: ${finalDirectory}`);
    
    // Apply changes sequentially to ensure proper handling
    const updatedFiles: string[] = [];
    const failedFiles: { path: string, reason: string }[] = [];
    
    for (const file of changes) {
      try {
        await applyFileChanges(file, finalDirectory);
        console.log(`Applied ${file.file_operation} operation to ${file.file_path}`);
        updatedFiles.push(file.file_path);
      } catch (error: any) {
        console.error(`Failed to apply ${file.file_operation} to ${file.file_path}:`, error);
        failedFiles.push({ 
          path: file.file_path, 
          reason: error.message || 'Unknown error' 
        });
      }
    }
    
    // Determine outcome based on results
    const success = updatedFiles.length > 0;
    const message = success 
      ? `Successfully applied changes to ${updatedFiles.length} of ${changes.length} files.` 
      : "No files were updated successfully.";
    
    // Include both successful and failed files in response
    return { 
      success: success,  // Only return true if at least one file was updated
      message: message,
      updatedFiles: updatedFiles,
      failedFiles: failedFiles,
      details: updatedFiles.length > 0 
        ? `Updated files: ${updatedFiles.join(', ')}` 
        : "No files were updated.",
      warningMessage: failedFiles.length > 0 
        ? `Failed to update ${failedFiles.length} files: ${failedFiles.map(f => f.path).join(', ')}` 
        : undefined
    };
  } catch (error: any) {
    console.error("Error applying changes:", error);
    throw new Error(`Failed to apply changes: ${error.message}`);
  }
} 