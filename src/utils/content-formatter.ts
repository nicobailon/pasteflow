import fs from 'node:fs';
import path from 'node:path';

import { FileData, FileTreeMode, RolePrompt, SelectedFileWithLines, SystemPrompt, LineSelectionValidationResult } from "../types/file-types";

import { extname, generateAsciiFileTree, getAllDirectories, getRelativePath, normalizePath } from "./path-utils";
import { validateLineSelections, extractContentForLines } from './workspace-utils';

/**
 * Helper function to sort files according to the current sort order
 */
const sortFilesByOrder = (files: FileData[], sortOrder: string): FileData[] => {
  const [sortKey, sortDir] = sortOrder.split("-");
  return [...files].sort((a: FileData, b: FileData) => {
    let comparison = 0;

    switch (sortKey) {
      case "name": {
        comparison = a.name.localeCompare(b.name);
        break;
      }
      case "tokens": {
        comparison = (a.tokenCount || 0) - (b.tokenCount || 0);
        break;
      }
      case "size": {
        comparison = a.size - b.size;
        break;
      }
      // No default
    }

    return sortDir === "asc" ? comparison : -comparison;
  });
};

/**
 * Generate file tree items based on the current mode
 */
const generateFileTreeItems = (
  allFiles: FileData[],
  sortedSelected: FileData[],
  fileTreeMode: FileTreeMode,
  normalizedRootFolder: string
): { path: string; isFile?: boolean }[] => {
  switch (fileTreeMode) {
    case "selected": {
      // Only include selected files
      return sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }));
    }
    
    case "selected-with-roots": {
      // Include all directories and selected files to show the complete folder structure
      // Filter out skipped files when getting directories
      const filteredFiles = allFiles.filter((file: FileData) => !file.isSkipped);
      const allDirs = getAllDirectories(filteredFiles, normalizedRootFolder);
      return [
        ...allDirs.map(dir => ({ path: dir, isFile: false })),
        ...sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }))
      ];
    }
    
    case "complete": {
      // Include all non-skipped files
      return allFiles
        .filter((file: FileData) => !file.isSkipped)
        .map((file: FileData) => ({ path: file.path, isFile: true }));
    }
    
    default: {
      return [];
    }
  }
};

/**
 * Map file extension to appropriate language identifier for code blocks
 */
const getLanguageIdentifier = (extension: string, filePath: string): string => {
  // Web development languages
  switch (extension) {
    case 'js': { return 'javascript'; }
    case 'ts': { return 'typescript'; }
    case 'tsx': { return 'tsx'; }
    case 'jsx': { return 'jsx'; }
    case 'css': { return 'css'; }
    case 'scss': 
    case 'sass': { return 'scss'; }
    case 'less': { return 'less'; }
    case 'html': { return 'html'; }
    case 'json': { return 'json'; }
    case 'md': { return 'markdown'; }
    case 'svg': { return 'svg'; }
    case 'py': { return 'python'; }
    case 'rb': { return 'ruby'; }
    case 'php': { return 'php'; }
    case 'java': { return 'java'; }
    case 'cs': { return 'csharp'; }
    case 'go': { return 'go'; }
    case 'rs': { return 'rust'; }
    case 'swift': { return 'swift'; }
    case 'kt': 
    case 'kts': { return 'kotlin'; }
    case 'c': 
    case 'h': { return 'c'; }
    case 'cpp': 
    case 'cc': 
    case 'cxx': 
    case 'hpp': { return 'cpp'; }
    case 'sh': 
    case 'bash': { return 'bash'; }
    case 'ps1': { return 'powershell'; }
    case 'bat': 
    case 'cmd': { return 'batch'; }
    case 'yaml': 
    case 'yml': { return 'yaml'; }
    case 'toml': { return 'toml'; }
    case 'ini': { return 'ini'; }
    default: { 
      if (extension === 'dockerfile' || filePath.toLowerCase().endsWith('dockerfile')) return 'dockerfile';
      // Database
      else if (extension === 'sql') return 'sql';
      // Fallback to plaintext if no matching language is found
      else return extension || 'plaintext';
    }
  }
};

/**
 * Process content for a file based on the selected lines
 */
export function processFileContent(
  fileContent: string | undefined,
  selectedFileInfo: SelectedFileWithLines | undefined,
  onValidationChange?: (result: LineSelectionValidationResult) => void
): { content: string; partial: boolean } {
  if (!selectedFileInfo || !selectedFileInfo.lines) {
    return { content: fileContent || '', partial: false };
  }

  if (!fileContent) {
    if (onValidationChange) {
      onValidationChange({
        isValid: true,
        validatedLines: selectedFileInfo.lines,
        removedLines: [],
        contentAvailable: false
      });
    }
    return { content: '', partial: false };
  }

  const validation = validateLineSelections(fileContent, selectedFileInfo);
  
  if (!validation.isValid && onValidationChange) {
    onValidationChange(validation);
  }

  if (!validation.validatedLines) {
    return { content: fileContent, partial: false };
  }

  const selectedContent = extractContentForLines(fileContent, validation.validatedLines);

  return {
    content: selectedContent,
    partial: true
  };
}

/**
 * Generates a formatted string containing all selected files' contents without user instructions.
 * The function organizes files according to the current sort order and includes an ASCII file tree
 * representation based on the fileTreeMode setting.
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {string} sortOrder - Current sort order
 * @param {FileTreeMode} fileTreeMode - Current file tree mode
 * @param {string | null} selectedFolder - Selected folder path
 * @returns {string} A formatted string with selected files' content wrapped in codebase tags.
 */
export const getSelectedFilesContentWithoutInstructions = (
  allFiles: FileData[],
  selectedFiles: SelectedFileWithLines[],
  sortOrder: string,
  fileTreeMode: FileTreeMode,
  selectedFolder: string | null
): string => {
  // Create a Map from selectedFiles for faster lookups
  const selectedFilesMap = new Map(selectedFiles.map(file => [file.path, file]));
  
  // Sort selected files according to current sort order
  const filteredFiles = allFiles.filter((file: FileData) => selectedFilesMap.has(file.path));
  const sortedSelected = sortFilesByOrder(filteredFiles, sortOrder);

  if (sortedSelected.length === 0) {
    return "No files selected.";
  }

  // Start with opening codebase tag
  let concatenatedString = "<codebase>\n";
  
  // Add ASCII file tree if enabled
  if (fileTreeMode !== "none" && selectedFolder) {
    const normalizedRootFolder = normalizePath(selectedFolder);
    const fileTreeItems = generateFileTreeItems(allFiles, sortedSelected, fileTreeMode, normalizedRootFolder);
    
    if (fileTreeItems.length > 0) {
      const asciiTree = generateAsciiFileTree(fileTreeItems, normalizedRootFolder);
      concatenatedString += `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
    }
  }
  
  for (const file of sortedSelected) {
    const selectedFileInfo = selectedFilesMap.get(file.path);
    if (!selectedFileInfo?.isContentLoaded || selectedFileInfo.content === undefined) {
      console.warn(`Content not loaded for ${file.path} when formatting. Skipping.`);
      continue;
    }
    const { content, partial } = processFileContent(selectedFileInfo.content, selectedFileInfo);
    let relativePath = file.path;

    if (selectedFolder) {
      const normalizedFilePath = normalizePath(file.path);
      const normalizedRootPath = normalizePath(selectedFolder);

      try {
        relativePath = getRelativePath(normalizedFilePath, normalizedRootPath);
      } catch (error) {
        console.error("Error calculating relative path:", error);
      }
    }

    const extension = extname(file.path).replace(/^\./, "").toLowerCase();
    const languageIdentifier = getLanguageIdentifier(extension, file.path);

    let fileHeader = `\nFile: ${relativePath}`;
    if (partial) {
      fileHeader += " (Selected Lines)";
    }

    concatenatedString += `${fileHeader}\n\`\`\`${languageIdentifier}\n${content}\n\`\`\`\n`;
  }
  
  // Close codebase tag
  concatenatedString += "</codebase>";
  
  return concatenatedString;
};

/**
 * Gets the content of selected files with optional system prompt and user instructions.
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {string} sortOrder - Current sort order
 * @param {FileTreeMode} fileTreeMode - Current file tree mode
 * @param {string | null} selectedFolder - Selected folder path
 * @param {SystemPrompt[]} selectedSystemPrompts - Array of selected system prompts
 * @param {RolePrompt[]} selectedRolePrompts - Array of selected role prompts
 * @param {string} userInstructions - User instructions to append
 * @returns {string} A formatted string with selected files' content and optional prompts.
 */
export const getSelectedFilesContent = (
  allFiles: FileData[],
  selectedFiles: SelectedFileWithLines[],
  sortOrder: string,
  fileTreeMode: FileTreeMode,
  selectedFolder: string | null,
  selectedSystemPrompts: SystemPrompt[],
  selectedRolePrompts: RolePrompt[],
  userInstructions: string
): string => {
  // Get base content without instructions
  const baseContent = getSelectedFilesContentWithoutInstructions(
    allFiles,
    selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder
  );

  // Add system prompts if any are selected
  let result = baseContent;
  if (selectedSystemPrompts.length > 0) {
    const systemPromptsText = selectedSystemPrompts
      .map(prompt => prompt.content)
      .join('\n\n');
    result = `${systemPromptsText}\n\n${result}`;
  }

  // Add role prompts if any are selected
  if (selectedRolePrompts.length > 0) {
    const rolePromptsText = selectedRolePrompts
      .map(prompt => prompt.content)
      .join('\n\n');
    result = `${rolePromptsText}\n\n${result}`;
  }

  // Add user instructions if provided
  if (userInstructions) {
    result = `${result}\n\n${userInstructions}`;
  }

  return result;
};

export function getFileType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  switch (extension) {
    case 'js': { return 'javascript'; }
    case 'jsx': { return 'javascript'; }
    case 'ts': { return 'typescript'; }
    case 'tsx': { return 'typescript'; }
    case 'py': { return 'python'; }
    case 'java': { return 'java'; }
    case 'cpp': { return 'cpp'; }
    case 'c': { return 'c'; }
    case 'cs': { return 'csharp'; }
    case 'go': { return 'go'; }
    case 'rs': { return 'rust'; }
    case 'swift': { return 'swift'; }
    case 'kt': { return 'kotlin'; }
    case 'rb': { return 'ruby'; }
    case 'php': { return 'php'; }
    case 'html': { return 'html'; }
    case 'css': { return 'css'; }
    case 'scss': { return 'scss'; }
    case 'json': { return 'json'; }
    case 'md': { return 'markdown'; }
    case 'sh': { return 'shell'; }
    case 'bash': { return 'shell'; }
    case 'zsh': { return 'shell'; }
    case 'sql': { return 'sql'; }
    case 'yaml': { return 'yaml'; }
    case 'yml': { return 'yaml'; }
    case 'toml': { return 'toml'; }
    default: { return extension || 'plaintext'; }
  }
}

/**
 * Gets the content of selected files with optional system prompt and user instructions.
 * @param {string[]} selectedFiles - Array of selected file paths
 * @param {string} [systemPrompt] - Optional system prompt to prepend
 * @param {string} [userInstructions] - Optional user instructions to append
 * @returns {string} A formatted string with selected files' content and optional prompts.
 */
export const getSimpleFileContent = (
  selectedFiles: string[],
  systemPrompt?: string,
  userInstructions?: string
): string => {
  let content = '';

  // Add system prompt if provided
  if (systemPrompt) {
    content += `${systemPrompt}\n\n`;
  }

  // Add file contents
  content += selectedFiles
    .map((filePath) => {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const fileName = path.basename(filePath);
        const fileType = getFileType(fileName);
        return `\`\`\`${fileType}\n${fileContent}\n\`\`\``;
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return `Error reading file ${filePath}`;
      }
    })
    .join('\n\n');

  // Add user instructions if provided
  if (userInstructions) {
    content += `\n\n${userInstructions}`;
  }

  return content;
};