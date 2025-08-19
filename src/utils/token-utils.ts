import { FileData, FileTreeMode, RolePrompt, SelectedFileReference, SystemPrompt } from "../types/file-types";
import { TOKEN_COUNTING } from '@constants';

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
    // Simple estimation using centralized constant
    return Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN);
  } catch (error) {
    console.error("Error estimating token count:", error);
    // Return a safe fallback value
    return Math.ceil((text?.length || 0) / TOKEN_COUNTING.CHARS_PER_TOKEN);
  }
};

/**
 * Calculate token count for a specific file with line selections
 * @param fileData - The file data containing content
 * @param lines - Array of line ranges
 * @returns - Estimated token count for selected lines
 */
// This function was used in the previous token counting implementation but is
// no longer needed with lazy loading. Keeping here for reference in case it
// becomes useful in the future.
/* 
const calculateSelectedLinesTokens = (fileData: FileData, lines: { start: number; end: number }[]): number => {
  const contentLines = fileData.content.split('\n');
  let selectedContent = '';
  
  for (const range of lines) {
    for (let i = range.start - 1; i < range.end; i++) {
      if (i >= 0 && i < contentLines.length) {
        selectedContent += contentLines[i] + '\n';
      }
    }
  }
  
  return estimateTokenCount(selectedContent);
};
*/

/**
 * Calculates the total token count for all selected files.
 * 
 * @param {SelectedFileWithLines[]} selectedFiles - Array of selected files
 * @returns {number} The sum of token counts from all selected files.
 */
export const calculateTotalTokens = (selectedFiles: SelectedFileReference[], allFiles: FileData[]): number => {
  const allFilesMap = new Map(allFiles.map(file => [file.path, file]));
  let total = 0;
  
  for (const selectedFile of selectedFiles) {
    const fileData = allFilesMap.get(selectedFile.path);
    if (fileData && fileData.isContentLoaded && fileData.tokenCount !== undefined) {
      // If the selection has specific line ranges, we need to calculate token count for those lines
      if (selectedFile.lines && selectedFile.lines.length > 0) {
        // This is a simplified calculation - in reality you might want to 
        // count tokens for the specific line ranges
        const lines = fileData.content?.split('\n') || [];
        let selectedContent = '';
        for (const range of selectedFile.lines) {
          selectedContent += lines.slice(range.start - 1, range.end).join('\n') + '\n';
        }
        total += estimateTokenCount(selectedContent);
      } else {
        // Full file selected
        total += fileData.tokenCount;
      }
    }
  }
  return total;
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
  selectedFiles: SelectedFileReference[],
  selectedFolder: string | null
): Record<FileTreeMode, number> => {
  const tokenCounts: Record<FileTreeMode, number> = {
    "none": 0,
    "selected": 0,
    "selected-with-roots": 0, 
    "complete": 0
  };
  
  if (!selectedFolder) return tokenCounts;
  
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
  selectedFiles: SelectedFileReference[],
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
  let total = 0;
  for (const prompt of selectedSystemPrompts) {
    total += estimateTokenCount(prompt.content);
  }
  return total;
};

/**
 * Calculate total token count for all selected role prompts
 * @param {RolePrompt[]} selectedRolePrompts - Array of selected role prompts
 * @returns {number} Total tokens for selected role prompts
 */
export const calculateRolePromptsTokens = (selectedRolePrompts: RolePrompt[]): number => {
  let total = 0;
  for (const prompt of selectedRolePrompts) {
    total += estimateTokenCount(prompt.content);
  }
  return total;
};