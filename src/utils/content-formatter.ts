import { FileData, SelectedFileWithLines, SystemPrompt, RolePrompt, FileTreeMode } from "../types/file-types";
import { generateAsciiFileTree, getAllDirectories, normalizePath, getRelativePath, extname } from "./path-utils";

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
  const [sortKey, sortDir] = sortOrder.split("-");
  const sortedSelected = allFiles
    .filter((file: FileData) => selectedFilesMap.has(file.path))
    .sort((a: FileData, b: FileData) => {
      let comparison = 0;

      if (sortKey === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortKey === "tokens") {
        comparison = a.tokenCount - b.tokenCount;
      } else if (sortKey === "size") {
        comparison = a.size - b.size;
      }

      return sortDir === "asc" ? comparison : -comparison;
    });

  if (sortedSelected.length === 0) {
    return "No files selected.";
  }

  // Start with opening codebase tag
  let concatenatedString = "<codebase>\n";
  
  // Add ASCII file tree if enabled
  if (fileTreeMode !== "none" && selectedFolder) {
    let fileTreeItems: { path: string; isFile?: boolean }[] = [];
    const normalizedRootFolder = normalizePath(selectedFolder);

    if (fileTreeMode === "selected") {
      // Only include selected files
      fileTreeItems = sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }));
    } else if (fileTreeMode === "selected-with-roots") {
      // Include all directories and selected files to show the complete folder structure
      // Filter out skipped files when getting directories
      const filteredFiles = allFiles.filter((file: FileData) => !file.isSkipped);
      const allDirs = getAllDirectories(filteredFiles, normalizedRootFolder);
      fileTreeItems = [
        ...allDirs.map(dir => ({ path: dir, isFile: false })),
        ...sortedSelected.map((file: FileData) => ({ path: file.path, isFile: true }))
      ];
    } else if (fileTreeMode === "complete") {
      // Include all non-skipped files
      fileTreeItems = allFiles
        .filter((file: FileData) => !file.isSkipped)
        .map((file: FileData) => ({ path: file.path, isFile: true }));
    }

    const asciiTree = generateAsciiFileTree(fileTreeItems, normalizedRootFolder);
    concatenatedString += `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
  }
  
  sortedSelected.forEach((file: FileData) => {
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
    
    // Map file extensions to appropriate language identifiers for code blocks
    let languageIdentifier = extension;
    // Web development languages
    if (extension === 'js') languageIdentifier = 'javascript';
    else if (extension === 'ts') languageIdentifier = 'typescript';
    else if (extension === 'tsx') languageIdentifier = 'tsx';
    else if (extension === 'jsx') languageIdentifier = 'jsx';
    else if (extension === 'css') languageIdentifier = 'css';
    else if (extension === 'scss' || extension === 'sass') languageIdentifier = 'scss';
    else if (extension === 'less') languageIdentifier = 'less';
    else if (extension === 'html') languageIdentifier = 'html';
    else if (extension === 'json') languageIdentifier = 'json';
    else if (extension === 'md') languageIdentifier = 'markdown';
    else if (extension === 'xml') languageIdentifier = 'xml';
    else if (extension === 'svg') languageIdentifier = 'svg';
    
    // Backend languages
    else if (extension === 'py') languageIdentifier = 'python';
    else if (extension === 'rb') languageIdentifier = 'ruby';
    else if (extension === 'php') languageIdentifier = 'php';
    else if (extension === 'java') languageIdentifier = 'java';
    else if (extension === 'cs') languageIdentifier = 'csharp';
    else if (extension === 'go') languageIdentifier = 'go';
    else if (extension === 'rs') languageIdentifier = 'rust';
    else if (extension === 'swift') languageIdentifier = 'swift';
    else if (extension === 'kt' || extension === 'kts') languageIdentifier = 'kotlin';
    else if (extension === 'c' || extension === 'h') languageIdentifier = 'c';
    else if (extension === 'cpp' || extension === 'cc' || extension === 'cxx' || extension === 'hpp') languageIdentifier = 'cpp';
    
    // Shell and configuration
    else if (extension === 'sh' || extension === 'bash') languageIdentifier = 'bash';
    else if (extension === 'ps1') languageIdentifier = 'powershell';
    else if (extension === 'bat' || extension === 'cmd') languageIdentifier = 'batch';
    else if (extension === 'yaml' || extension === 'yml') languageIdentifier = 'yaml';
    else if (extension === 'toml') languageIdentifier = 'toml';
    else if (extension === 'ini') languageIdentifier = 'ini';
    else if (extension === 'dockerfile' || file.path.toLowerCase().endsWith('dockerfile')) languageIdentifier = 'dockerfile';
    
    // Database
    else if (extension === 'sql') languageIdentifier = 'sql';
    
    // Fallback to plaintext if no matching language is found
    else if (!languageIdentifier) languageIdentifier = 'plaintext';
    
    // Get the selected file info including any line selections
    const selectedFileInfo = selectedFilesMap.get(file.path);
    let content = file.content;
    
    // Format the file header
    let fileHeader = `\nFile: ${relativePath}`;
    
    // If we have line selections, only include those lines
    if (selectedFileInfo && selectedFileInfo.lines && selectedFileInfo.lines.length > 0) {
      // Add a note about partial selection to the header
      fileHeader += ` (Selected Lines)`;
      
      // If we have precomputed content, use it
      if (selectedFileInfo.content) {
        content = selectedFileInfo.content;
      } else {
        // Otherwise compute it from the ranges
        const lines = content.split('\n');
        const selectedContent: string[] = [];
        
        selectedFileInfo.lines.forEach(range => {
          for (let i = range.start - 1; i < range.end; i++) {
            if (i >= 0 && i < lines.length) {
              selectedContent.push(lines[i]);
            }
          }
        });
        
        content = selectedContent.join('\n');
      }
    }
    
    // Add file content with file header and code block
    concatenatedString += `${fileHeader}\n\`\`\`${languageIdentifier}\n${content}\n\`\`\`\n`;
  });
  
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
    selectedRolePrompts.forEach((prompt: RolePrompt) => {
      result += `\n\n<role>\n${prompt.content}\n</role>`;
    });
  }
  
  // Add system prompts if selected
  if (selectedSystemPrompts.length > 0) {
    selectedSystemPrompts.forEach((prompt: SystemPrompt) => {
      result += `\n\n<guidelines>\n${prompt.content}\n</guidelines>`;
    });
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
    selectedRolePrompts.forEach((prompt: RolePrompt) => {
      result += `\n\n<role>\n${prompt.content}\n</role>`;
    });
  }
  
  // Add system prompts if selected
  if (selectedSystemPrompts.length > 0) {
    selectedSystemPrompts.forEach((prompt: SystemPrompt) => {
      result += `\n\n<guidelines>\n${prompt.content}\n</guidelines>`;
    });
  }
  
  // Add user instructions at the very end if they exist
  if (userInstructions) {
    result += `\n\n<user_instructions>\n${userInstructions}\n</user_instructions>`;
  }
  
  return result;
};