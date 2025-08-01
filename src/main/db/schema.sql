-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Version tracking for future migrations
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Workspaces with complete state serialization
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  folder_path TEXT NOT NULL,
  state_json TEXT NOT NULL, -- Complete serialized WorkspaceState
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_accessed INTEGER DEFAULT (strftime('%s', 'now'))
);

-- File metadata with content deduplication
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  content_hash TEXT,
  size INTEGER NOT NULL,
  is_binary BOOLEAN NOT NULL DEFAULT 0,
  token_count INTEGER,
  last_modified INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE(path, workspace_id)
);

-- Deduplicated file contents with compression
CREATE TABLE file_contents (
  hash TEXT PRIMARY KEY,
  content BLOB NOT NULL, -- Compressed with zlib
  original_size INTEGER NOT NULL,
  compressed_size INTEGER NOT NULL,
  compression_ratio REAL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- User preferences (replaces electron-settings)
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT 0,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- System and role prompts
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('system', 'role')),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  is_active BOOLEAN DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Instructions and documentation
CREATE TABLE instructions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Audit log for critical operations
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Performance indexes
CREATE INDEX idx_files_workspace ON files(workspace_id);
CREATE INDEX idx_files_hash ON files(content_hash);
CREATE INDEX idx_workspaces_accessed ON workspaces(last_accessed DESC);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);

-- Auto-update triggers
CREATE TRIGGER update_workspace_timestamp 
AFTER UPDATE ON workspaces
BEGIN
  UPDATE workspaces SET updated_at = strftime('%s', 'now') 
  WHERE id = NEW.id;
END;

CREATE TRIGGER update_prompt_timestamp 
AFTER UPDATE ON prompts
BEGIN
  UPDATE prompts SET updated_at = strftime('%s', 'now') 
  WHERE id = NEW.id;
END;

-- Insert initial schema version
INSERT INTO schema_version (version) VALUES (1);