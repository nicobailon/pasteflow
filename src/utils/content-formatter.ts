import { FileData, FileTreeMode, RolePrompt, SelectedFileWithLines, SystemPrompt } from "../types/file-types";

import { extname, generateAsciiFileTree, getAllDirectories, getRelativePath, normalizePath } from "./path-utils";

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
        comparison = a.tokenCount - b.tokenCount;
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
    case 'js': { return 'javascript';
    }
    case 'ts': { return 'typescript';
    }
    case 'tsx': { return 'tsx';
    }
    case 'jsx': { return 'jsx';
    }
    case 'css': { return 'css';
    }
    case 'scss': 
    case 'sass': { return 'scss';
    }
    case 'less': { return 'less';
    }
    case 'html': { return 'html';
    }
    case 'json': { return 'json';
    }
    case 'md': { return 'markdown';
    }
    case 'xml': { return 'xml';
    }
    case 'svg': { return 'svg';
    }
    case 'py': { return 'python';
    }
    case 'rb': { return 'ruby';
    }
    case 'php': { return 'php';
    }
    case 'java': { return 'java';
    }
    case 'cs': { return 'csharp';
    }
    case 'go': { return 'go';
    }
    case 'rs': { return 'rust';
    }
    case 'swift': { return 'swift';
    }
    case 'kt': 
    case 'kts': { return 'kotlin';
    }
    case 'c': 
    case 'h': { return 'c';
    }
    case 'cpp': 
    case 'cc': 
    case 'cxx': 
    case 'hpp': { return 'cpp';
    }
    case 'sh': 
    case 'bash': { return 'bash';
    }
    case 'ps1': { return 'powershell';
    }
    case 'bat': 
    case 'cmd': { return 'batch';
    }
    case 'yaml': 
    case 'yml': { return 'yaml';
    }
    case 'toml': { return 'toml';
    }
    case 'ini': { return 'ini';
    }
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
const processFileContent = (
  fileContent: string, 
  selectedFileInfo: SelectedFileWithLines | undefined
): { content: string, partial: boolean } => {
  let content = fileContent;
  let partial = false;
  
  // If we have line selections, only include those lines
  if (selectedFileInfo?.lines && selectedFileInfo.lines.length > 0) {
    partial = true;
    
    // If we have precomputed content, use it
    if (selectedFileInfo.content) {
      content = selectedFileInfo.content;
    } else {
      // Otherwise compute it from the ranges
      const lines = content.split('\n');
      const selectedContent: string[] = [];
      
      for (const range of selectedFileInfo.lines) {
        for (let i = range.start - 1; i < range.end; i++) {
          if (i >= 0 && i < lines.length) {
            selectedContent.push(lines[i]);
          }
        }
      }
      
      content = selectedContent.join('\n');
    }
  }
  
  return { content, partial };
};

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
    // Calculate the relative path from the selected folder
    let relativePath = file.path;
    
    if (selectedFolder) {
      // Normalize paths to handle platform-specific separators
      const normalizedFilePath = normalizePath(file.path);
      const normalizedRootPath = normalizePath(selectedFolder);
      
      try {
        // getRelativePath expects (filePath, baseDir)
        relativePath = getRelativePath(normalizedFilePath, normalizedRootPath);
      } catch (error) {
        // Fallback if getRelativePath fails
        console.error("Error calculating relative path:", error);
      }
    }
    
    // Determine the file extension for the code block language
    const extension = extname(file.path).replace(/^\./, '').toLowerCase() || '';
    const languageIdentifier = getLanguageIdentifier(extension, file.path);
    
    // Get the selected file info including any line selections
    const selectedFileInfo = selectedFilesMap.get(file.path);
    const { content, partial } = processFileContent(file.content, selectedFileInfo);
    
    // Format the file header
    let fileHeader = `\nFile: ${relativePath}`;
    if (partial) {
      fileHeader += ` (Selected Lines)`;
    }
    
    // Add file content with file header and code block
    concatenatedString += `${fileHeader}\n\`\`\`${languageIdentifier}\n${content}\n\`\`\`\n`;
  }
  
  // Close codebase tag
  concatenatedString += "</codebase>";
  
  return concatenatedString;
};

/**
 * Generates a formatted string containing selected files' content with optional user instructions.
 * This function extends getSelectedFilesContentWithoutInstructions by adding any user-provided 
 * instructions from the textarea input.
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {string} sortOrder - Current sort order
 * @param {FileTreeMode} fileTreeMode - Current file tree mode
 * @param {string | null} selectedFolder - Selected folder path
 * @param {SystemPrompt[]} selectedSystemPrompts - Selected system prompts
 * @param {RolePrompt[]} selectedRolePrompts - Selected role prompts
 * @param {string} userInstructions - User-provided instructions
 * @returns {string} A formatted string with selected files' content and optional user instructions.
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
  // Get the base content
  const baseContent = getSelectedFilesContentWithoutInstructions(
    allFiles,
    selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder
  );
  
  let result = baseContent;
  
  // Add role prompts if selected (before system prompts)
  if (selectedRolePrompts.length > 0) {
    for (const prompt of selectedRolePrompts) {
      result += `\n\n<role>\n${prompt.content}\n</role>`;
    }
  }
  
  // Add system prompts if selected
  if (selectedSystemPrompts.length > 0) {
    for (const prompt of selectedSystemPrompts) {
      result += `\n\n<guidelines>\n${prompt.content}\n</guidelines>`;
    }
  }
  
  // Append user instructions if they exist
  if (userInstructions) {
    result += `\n\n<user_instructions>\n${userInstructions}\n</user_instructions>`;
  }
  
  return result;
};

/**
 * Generates content with XML formatting instructions and optional system prompt and user instructions.
 * 
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {string} sortOrder - Current sort order
 * @param {FileTreeMode} fileTreeMode - Current file tree mode
 * @param {string | null} selectedFolder - Selected folder path
 * @param {SystemPrompt[]} selectedSystemPrompts - Selected system prompts
 * @param {RolePrompt[]} selectedRolePrompts - Selected role prompts
 * @param {string} userInstructions - User-provided instructions
 * @param {string} xmlFormatInstructions - XML formatting instructions
 * @returns {string} A formatted string with selected files' content, XML instructions, and optional prompts.
 */
export const getContentWithXmlPrompt = (
  allFiles: FileData[],
  selectedFiles: SelectedFileWithLines[],
  sortOrder: string,
  fileTreeMode: FileTreeMode,
  selectedFolder: string | null,
  selectedSystemPrompts: SystemPrompt[],
  selectedRolePrompts: RolePrompt[],
  userInstructions: string,
  xmlFormatInstructions: string
): string => {
  // Get the content without user instructions
  const baseContent = getSelectedFilesContentWithoutInstructions(
    allFiles,
    selectedFiles,
    sortOrder,
    fileTreeMode,
    selectedFolder
  );
  
  // Combine content with XML instructions
  let result = `${baseContent}\n\n${xmlFormatInstructions}`;
  
  // Add role prompts if selected
  if (selectedRolePrompts.length > 0) {
    for (const prompt of selectedRolePrompts) {
      result += `\n\n<role>\n${prompt.content}\n</role>`;
    }
  }
  
  // Add system prompts if selected
  if (selectedSystemPrompts.length > 0) {
    for (const prompt of selectedSystemPrompts) {
      result += `\n\n<guidelines>\n${prompt.content}\n</guidelines>`;
    }
  }
  
  // Add user instructions at the very end if they exist
  if (userInstructions) {
    result += `\n\n<user_instructions>\n${userInstructions}\n</user_instructions>`;
  }
  
  return result;
};