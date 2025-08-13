// Zod schemas for main process (CommonJS) to validate IPC inputs/outputs
// Mirrors the TS schemas where practical for the Workspace routes.

const { z } = require('zod');

// Workspace schemas
// Transitional: keep id as string() for load/touch to allow name or uuid; enforce uuid later in consolidated path
const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessed: z.number()
});

const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional()
});

// Legacy/compat Update schema used by main.js: allow id or name, folderPath optional, state optional
// This differs from the newer strict UUID-only update
const WorkspaceUpdateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  folderPath: z.string().optional(),
  state: z.record(z.string(), z.unknown()).optional()
}).refine((v) => !!v.id || !!v.name, { message: 'id or name is required' });

const WorkspaceLoadSchema = z.object({ id: z.string().min(1) });
const WorkspaceDeleteSchema = z.object({ id: z.string().min(1) });
const WorkspaceRenameSchema = z.object({
  oldName: z.string().min(1).max(255),
  newName: z.string().min(1).max(255)
});

const WorkspaceTouchSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional()
}).refine((v) => !!v.id || !!v.name, { message: 'id or name is required' });

// Non-workspace schemas for main.js handlers
const FileListRequestSchema = z.object({
  folderPath: z.string().min(1),
  exclusionPatterns: z.array(z.string()).max(50).optional().nullable(),
  requestId: z.string().max(255).optional().nullable()
});

const RequestFileContentSchema = z.object({
  filePath: z.string().min(1)
});

const CancelFileLoadingSchema = z.object({
  requestId: z.string().max(255).optional().nullable()
});

const OpenDocsSchema = z.object({
  docName: z.string().regex(/^[a-zA-Z0-9._-]+\.(md|txt|pdf)$/i)
});

const FolderSelectionSchema = z.object({});

module.exports = {
  z,
  WorkspaceSchema,
  WorkspaceCreateSchema,
  WorkspaceUpdateSchema,
  WorkspaceLoadSchema,
  WorkspaceDeleteSchema,
  WorkspaceRenameSchema,
  WorkspaceTouchSchema,
  FileListRequestSchema,
  RequestFileContentSchema,
  CancelFileLoadingSchema,
  OpenDocsSchema,
  FolderSelectionSchema
};

