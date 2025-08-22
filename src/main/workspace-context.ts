// Workspace context for allowed paths used by HTTP API and security status
export type WorkspacePaths = readonly [string] | readonly string[];

let allowedPaths: string[] = [];

export function setAllowedWorkspacePaths(paths: WorkspacePaths): void {
  allowedPaths = [...paths];
}

export function getAllowedWorkspacePaths(): readonly string[] {
  return allowedPaths;
}