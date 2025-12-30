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
    selectedSystemPromptIds: [],
    selectedRolePromptIds: []
  };
}

export function toDomainWorkspaceState(rowOrStateJson: WorkspaceRecord | string | null | undefined): WorkspaceState {
  const stateJson = typeof rowOrStateJson === "string" 
    ? rowOrStateJson 
    : (rowOrStateJson && typeof rowOrStateJson === "object" ? (rowOrStateJson as WorkspaceRecord).state : "");
  try {
    const parsed = stateJson ? (JSON.parse(stateJson) as Record<string, unknown>) : undefined;
    if (parsed) {
      if (parsed.systemPrompts && !parsed.selectedSystemPromptIds) {
        parsed.selectedSystemPromptIds = (parsed.systemPrompts as { id: string }[]).map((p) => p.id);
        delete parsed.systemPrompts;
      }
      if (parsed.rolePrompts && !parsed.selectedRolePromptIds) {
        parsed.selectedRolePromptIds = (parsed.rolePrompts as { id: string }[]).map((p) => p.id);
        delete parsed.rolePrompts;
      }
    }
    return (parsed as WorkspaceState) ?? defaultWorkspaceState();
  } catch {
    return defaultWorkspaceState();
  }
}

export function fromDomainWorkspaceState(state: WorkspaceState): string {
  return JSON.stringify(state);
}

export const __testOnly = { defaultWorkspaceState };

