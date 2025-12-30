export interface WorkspaceRecord {
  id: number;
  name: string;
  folder_path: string;
  state: string;
  created_at: number;
  updated_at: number;
  last_accessed: number;
}

export interface PreferenceRecord {
  key: string;
  value: string;
}

export interface InstructionRow {
  id: string;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface SystemPromptRow {
  id: string;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface RolePromptRow {
  id: string;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}
