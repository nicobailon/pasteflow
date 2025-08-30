import type { WorkspaceState } from "../../shared-types";
import type { WorkspaceRecord } from "./types";

function defaultWorkspaceState(): WorkspaceState {
  return {
    selectedFolder: null,
    selectedFiles: [],
    expandedNodes: {},
    sortOrder: "name",
    searchTerm: "",
    fileTreeMode: "selected-with-roots",
    exclusionPatterns: [],
    userInstructions: "",
    tokenCounts: {},
    systemPrompts: [],
    rolePrompts: []
  };
}

export function toDomainWorkspaceState(rowOrStateJson: WorkspaceRecord | string | null | undefined): WorkspaceState {
  const stateJson = typeof rowOrStateJson === "string" 
    ? rowOrStateJson 
    : (rowOrStateJson && typeof rowOrStateJson === "object" ? (rowOrStateJson as WorkspaceRecord).state : "");
  try {
    const parsed = stateJson ? (JSON.parse(stateJson) as WorkspaceState) : undefined;
    return parsed ?? defaultWorkspaceState();
  } catch {
    return defaultWorkspaceState();
  }
}

export function fromDomainWorkspaceState(state: WorkspaceState): string {
  return JSON.stringify(state);
}

export const __testOnly = { defaultWorkspaceState };

