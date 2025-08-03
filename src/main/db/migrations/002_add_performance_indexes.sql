-- Migration 002: Add composite indexes for performance optimization
-- Date: 2025-01-03
-- Purpose: Addresses performance issues identified in audit report

-- Update schema version
UPDATE schema_version SET version = 2;

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_files_path_workspace ON files(path, workspace_id);
CREATE INDEX IF NOT EXISTS idx_prompts_type_active ON prompts(type, is_active);
CREATE INDEX IF NOT EXISTS idx_preferences_key_updated ON preferences(key, updated_at);
CREATE INDEX IF NOT EXISTS idx_file_contents_hash_created ON file_contents(hash, created_at);

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_files_binary_workspace ON files(is_binary, workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_size_workspace ON files(size, workspace_id);
CREATE INDEX IF NOT EXISTS idx_prompts_active_updated ON prompts(is_active, updated_at DESC);

-- Covering index for file content lookups
CREATE INDEX IF NOT EXISTS idx_files_content_lookup ON files(workspace_id, path, content_hash, token_count);