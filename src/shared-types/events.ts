import type { SelectedFileReference } from "./selection";

export interface WorkspaceUpdatedPayload {
  workspaceId: string;
  folderPath: string;
  selectedFiles: SelectedFileReference[];
  sequence: number;
  timestamp: number;
}

