import { FileData, SelectedFileWithLines, SystemPrompt, RolePrompt, FileTreeMode } from "../types/file-types";
import { generateAsciiFileTree, getAllDirectories, normalizePath } from "./path-utils";

/**
 * Estimates token count for a given text.
 * Uses a simple estimation based on character count.
 * 
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
export const estimateTokenCount = (text: string): number => {
  if (!text) return 0;
  
  try {
    // Simple estimation: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  } catch (error) {
    console.error("Error estimating token count:", error);
    // Return a safe fallback value
    return Math.ceil((text?.length || 0) / 4);
  }
};

/**
 * Calculates the total token count for all selected files.
 * 
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {FileData[]} allFiles - Array of all files
 * @returns {number} The sum of token counts from all selected files.
 */
export const calculateTotalTokens = (
  selectedFiles: SelectedFileWithLines[],
  allFiles: FileData[]
): number => {
  return selectedFiles.reduce((total: number, file: SelectedFileWithLines) => {
    // If we have a precomputed token count, use it
    if (file.tokenCount !== undefined) {
      return total + file.tokenCount;
    }
    
    // If we have content, estimate tokens
    if (file.content) {
      return total + estimateTokenCount(file.content);
    }
    
    // Otherwise, find the file in allFiles and use its tokenCount
    const fileData = allFiles.find((f: FileData) => f.path === file.path);
    
    // If it has line selections, calculate tokens for those lines only
    if (file.lines && file.lines.length > 0 && fileData) {
      const lines = fileData.content.split('\n');
      let selectedContent = '';
      
      file.lines.forEach(range => {
        for (let i = range.start - 1; i < range.end; i++) {
          if (i >= 0 && i < lines.length) {
            selectedContent += lines[i] + '\n';
          }
        }
      });
      
      return total + estimateTokenCount(selectedContent);
    }
    
    return total + (fileData ? fileData.tokenCount : 0);
  }, 0);
};

/**
 * Calculate token counts for each file tree mode
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files 
 * @param {string | null} selectedFolder - Selected folder path
 * @returns {Record<FileTreeMode, number>} Token counts for each file tree mode
 */
export const calculateFileTreeTokens = (
  allFiles: FileData[],
  selectedFiles: SelectedFileWithLines[],
  selectedFolder: string | null
): Record<FileTreeMode, number> => {
  const tokenCounts: Record<FileTreeMode, number> = {
    "none": 0,
    "selected": 0,
    "selected-with-roots": 0, 
    "complete": 0
  };
  
  if (!selectedFolder) return tokenCounts;
  
  // Create a Set for faster lookups
  const selectedFilesSet = new Set(selectedFiles);
  
  // Normalize the root folder path
  const normalizedRootFolder = normalizePath(selectedFolder);
  
  // Pre-calculate commonly used filtered arrays
  const selectedFileItems = allFiles
    .filter((file: FileData) => selectedFiles.some(selected => selected.path === file.path))
    .map((file: FileData) => ({ 
      path: file.path, 
      isFile: true 
    }));
  
  // Calculate token counts for "selected" mode
  if (selectedFileItems.length > 0) {
    const selectedAsciiTree = generateAsciiFileTree(selectedFileItems, normalizedRootFolder);
    const selectedTreeContent = `<file_map>\n${selectedFolder}\n${selectedAsciiTree}\n</file_map>\n\n`;
    tokenCounts["selected"] = estimateTokenCount(selectedTreeContent);
  }
  
  // Calculate token counts for "selected-with-roots" mode
  if (selectedFileItems.length > 0) {
    // Filter non-skipped files only once
    const nonSkippedFiles = allFiles.filter((file: FileData) => !file.isSkipped);
    const allDirs = getAllDirectories(nonSkippedFiles, normalizedRootFolder);
    
    const fileTreeItems = [
      ...allDirs.map(dir => ({ path: dir, isFile: false })),
      ...selectedFileItems
    ];
    
    const asciiTree = generateAsciiFileTree(fileTreeItems, normalizedRootFolder);
    const treeContent = `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
    tokenCounts["selected-with-roots"] = estimateTokenCount(treeContent);
  }
  
  // Calculate token counts for "complete" mode
  const nonSkippedFiles = allFiles.filter((file: FileData) => !file.isSkipped);
  if (nonSkippedFiles.length > 0) {
    const completeFileItems = nonSkippedFiles.map((file: FileData) => ({ path: file.path, isFile: true }));
    const asciiTree = generateAsciiFileTree(completeFileItems, normalizedRootFolder);
    const treeContent = `<file_map>\n${selectedFolder}\n${asciiTree}\n</file_map>\n\n`;
    tokenCounts["complete"] = estimateTokenCount(treeContent);
  }
  
  return tokenCounts;
};

/**
 * Get the token count for the specified file tree mode
 * @param {FileData[]} allFiles - Array of all files
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @param {string | null} selectedFolder - Selected folder path
 * @param {FileTreeMode} fileTreeMode - The file tree mode to calculate tokens for
 * @returns {number} Token count for the specified file tree mode
 */
export const getFileTreeModeTokens = (
  allFiles: FileData[],
  selectedFiles: SelectedFileWithLines[],
  selectedFolder: string | null,
  fileTreeMode: FileTreeMode
): number => {
  const tokenCounts = calculateFileTreeTokens(allFiles, selectedFiles, selectedFolder);
  return tokenCounts[fileTreeMode];
};

/**
 * Calculate total token count for all selected system prompts
 * @param {SystemPrompt[]} selectedSystemPrompts - Array of selected system prompts
 * @returns {number} Total tokens for selected system prompts
 */
export const calculateSystemPromptsTokens = (selectedSystemPrompts: SystemPrompt[]): number => {
  return selectedSystemPrompts.reduce((total: number, prompt: SystemPrompt) => {
    return total + estimateTokenCount(prompt.content);
  }, 0);
};

/**
 * Calculate total token count for all selected role prompts
 * @param {RolePrompt[]} selectedRolePrompts - Array of selected role prompts
 * @returns {number} Total tokens for selected role prompts
 */
export const calculateRolePromptsTokens = (selectedRolePrompts: RolePrompt[]): number => {
  return selectedRolePrompts.reduce((total: number, prompt: RolePrompt) => {
    return total + estimateTokenCount(prompt.content);
  }, 0);
};