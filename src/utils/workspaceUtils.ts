import { WorkspaceState } from '../types/FileTypes';

/**
 * Serializes a WorkspaceState object to a JSON string
 * 
 * @param {WorkspaceState} state - The workspace state to serialize
 * @returns {string} JSON string representation of the workspace state
 */
export const serializeWorkspace = (state: WorkspaceState): string => {
  return JSON.stringify(state);
};

/**
 * Deserializes a JSON string into a WorkspaceState object
 * 
 * @param {string} data - The JSON string to deserialize
 * @returns {WorkspaceState} The deserialized workspace state
 */
export const deserializeWorkspace = (data: string): WorkspaceState => {
  return JSON.parse(data) as WorkspaceState;
};
