import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

interface FileChange {
  file_operation: string;
  file_path: string;
  file_code?: string;
}

export async function applyFileChanges(change: FileChange, projectDirectory: string) {
  const { file_operation, file_path, file_code } = change;
  
  // Verify that the project directory exists and is accessible
  try {
    await fs.access(projectDirectory);
  } catch (error: any) {
    throw new Error(`Project directory not accessible: ${projectDirectory}. Error: ${error.message}`);
  }
  
  const fullPath = join(projectDirectory, file_path);

  // For updates and deletes, verify the file exists
  if (file_operation.toUpperCase() === "UPDATE" || file_operation.toUpperCase() === "DELETE") {
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`File not found: ${file_path}. Unable to ${file_operation.toLowerCase()}.`);
    }
  }

  switch (file_operation.toUpperCase()) {
    case "CREATE": {
      if (!file_code) {
        throw new Error(`No file_code provided for CREATE operation on ${file_path}`);
      }
      await ensureDirectoryExists(dirname(fullPath));
      await fs.writeFile(fullPath, file_code, "utf8");
      break;
    }

    case "UPDATE": {
      if (!file_code) {
        throw new Error(`No file_code provided for UPDATE operation on ${file_path}`);
      }
      await ensureDirectoryExists(dirname(fullPath));
      await fs.writeFile(fullPath, file_code, "utf8");
      break;
    }

    case "DELETE": {
      await fs.rm(fullPath, { force: true });
      break;
    }

    default: {
      console.warn(`Unknown file_operation: ${file_operation} for file: ${file_path}`);
      break;
    }
  }
}

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    if (error.code !== "EEXIST") {
      console.error(`Error creating directory ${dir}:`, error);
      throw error;
    }
  }
} 