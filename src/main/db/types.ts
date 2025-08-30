import type { QueryResult } from "./connection-pool";

export interface WorkspaceRecord extends QueryResult {
  id: number;
  name: string;
  folder_path: string;
  state: string; // JSON-serialized WorkspaceState
  created_at: number;
  updated_at: number;
  last_accessed: number;
}

export interface PreferenceRecord extends QueryResult {
  key: string;
  value: string;
}

export interface InstructionRow extends QueryResult {
  id: string;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}
