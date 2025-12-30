import { z } from "zod";

import {
  LineRangeSchema,
  SelectedFileReferenceSchema,
  InstructionSchema as SharedInstructionSchema
} from "../../shared-schemas";

// Workspace schemas
export const WorkspaceSchema = z.object({
  // Some environments use UUID ids; others use human-readable names as ids.
  // Relax to string() to support both until full migration completes.
  id: z.string(),
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessed: z.number()
});

export const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional()
});

export const WorkspaceUpdateSchema = z.object({
  // Allow both UUID and numeric string IDs (database uses INTEGER PRIMARY KEY)
  id: z.string().min(1),
  state: z.record(z.string(), z.unknown())
});

export const WorkspaceLoadSchema = z.object({
  id: z.string().min(1)
});

export const WorkspaceTouchSchema = z.object({
  id: z.string().min(1)
});

export const WorkspaceDeleteSchema = z.object({
  // Allow both UUID and numeric string IDs (database uses INTEGER PRIMARY KEY)
  id: z.string().min(1)
});

export const WorkspaceRenameSchema = z.object({
  // Allow both UUID and numeric string IDs (database uses INTEGER PRIMARY KEY)
  id: z.string().min(1),
  newName: z.string().min(1).max(255)
});

// File schemas
export const FileContentRequestSchema = z.object({
  // Allow both UUID and numeric string IDs (database uses INTEGER PRIMARY KEY)
  workspaceId: z.string().min(1),
  filePath: z.string(),
  lineRanges: z.array(LineRangeSchema).optional()
});

// Legacy file content request schema for backward compatibility
export const RequestFileContentSchema = z.object({
  filePath: z.string()
});

export const FileContentResponseSchema = z.object({
  content: z.string(),
  tokenCount: z.number().int()
});

export const FileSaveSchema = z.object({
  // Allow both UUID and numeric string IDs (database uses INTEGER PRIMARY KEY)
  workspaceId: z.string().min(1),
  filePath: z.string(),
  content: z.string(),
  tokenCount: z.number().int().optional()
});

export const FileListRequestSchema = z.object({
  folderPath: z.string(),
  exclusionPatterns: z.array(z.string()).optional(),
  requestId: z.string().nullable().optional()
});

export const CancelFileLoadingSchema = z.object({
  requestId: z.string()
});

// Folder selection schema
export const FolderSelectionSchema = z.object({});

// Docs schema
export const OpenDocsSchema = z.object({
  docName: z.string().optional()
});

// Preference schemas
export const PreferenceGetSchema = z.object({
  key: z.string()
});

export const PreferenceSetSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  encrypted: z.boolean().optional().default(false)
});

// Prompt schemas
export const PromptSchema = z.object({
  id: z.string(),
  type: z.enum(['system', 'role']),
  name: z.string(),
  content: z.string(),
  tokenCount: z.number().int().optional(),
  isActive: z.boolean(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional()
});

// Instruction schemas
export const InstructionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  content: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const InstructionCreateSchema = z.object({
  name: SharedInstructionSchema.shape.name,
  content: SharedInstructionSchema.shape.content
});

// Workspace selection schemas
export const WorkspaceSelectionSchema = z.object({
  selectedFiles: z.array(
    SelectedFileReferenceSchema.extend({
      content: z.string().optional(),
      tokenCount: z.number().int().optional(),
      isFullFile: z.boolean().optional(),
      isContentLoaded: z.boolean().optional()
    })
  ),
  lastModified: z.number()
});

export const WorkspaceSelectionUpdateSchema = z.object({
  selectedFiles: z.array(
    SelectedFileReferenceSchema.extend({
      content: z.string().optional(),
      tokenCount: z.number().int().optional(),
      isFullFile: z.boolean().optional(),
      isContentLoaded: z.boolean().optional()
    })
  ),
  lastModified: z.number()
});

// Active prompts schemas
export const ActivePromptsSchema = z.object({
  systemPromptIds: z.array(z.string()),
  rolePromptIds: z.array(z.string())
});

// Audit log schemas
export const AuditLogEntrySchema = z.object({
  id: z.number(),
  operation: z.string(),
  tableName: z.string().optional(),
  recordId: z.string().optional(),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
  timestamp: z.number()
});

// Type exports for TypeScript usage
export type WorkspaceType = z.infer<typeof WorkspaceSchema>;
export type WorkspaceCreateType = z.infer<typeof WorkspaceCreateSchema>;
export type WorkspaceUpdateType = z.infer<typeof WorkspaceUpdateSchema>;
export type FileContentRequestType = z.infer<typeof FileContentRequestSchema>;
export type FileContentResponseType = z.infer<typeof FileContentResponseSchema>;
export type FileSaveType = z.infer<typeof FileSaveSchema>;
export type PreferenceGetType = z.infer<typeof PreferenceGetSchema>;
export type PreferenceSetType = z.infer<typeof PreferenceSetSchema>;

// Terminal IPC schemas
export const TerminalCreateSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  cols: z.number().int().optional(),
  rows: z.number().int().optional(),
});
export const TerminalWriteSchema = z.object({ id: z.string().min(1), data: z.string() });
export const TerminalResizeSchema = z.object({ id: z.string().min(1), cols: z.number().int().min(10).max(1000), rows: z.number().int().min(5).max(500) });
export const TerminalKillSchema = z.object({ id: z.string().min(1) });
export const TerminalOutputGetSchema = z.object({ id: z.string().min(1), fromCursor: z.number().int().optional(), maxBytes: z.number().int().optional() });

export type TerminalCreateType = z.infer<typeof TerminalCreateSchema>;
export type TerminalWriteType = z.infer<typeof TerminalWriteSchema>;
export type TerminalResizeType = z.infer<typeof TerminalResizeSchema>;
export type TerminalKillType = z.infer<typeof TerminalKillSchema>;
export type TerminalOutputGetType = z.infer<typeof TerminalOutputGetSchema>;
export type PromptType = z.infer<typeof PromptSchema>;
export type InstructionType = z.infer<typeof InstructionSchema>;
export type InstructionCreateType = z.infer<typeof InstructionCreateSchema>;
export type WorkspaceSelectionType = z.infer<typeof WorkspaceSelectionSchema>;
export type WorkspaceSelectionUpdateType = z.infer<typeof WorkspaceSelectionUpdateSchema>;
export type ActivePromptsType = z.infer<typeof ActivePromptsSchema>;
export type AuditLogEntryType = z.infer<typeof AuditLogEntrySchema>;
export type LineRangeType = z.infer<typeof LineRangeSchema>;
export type SelectedFileReferenceType = z.infer<typeof SelectedFileReferenceSchema>;
