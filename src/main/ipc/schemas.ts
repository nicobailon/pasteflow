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

// Agent IPC schemas (Phase 4)
export const AgentStartSessionSchema = z.object({
  seedId: z.string().optional(),
});

export const AgentExecuteToolSchema = z.object({
  sessionId: z.string().min(1),
  tool: z.enum(['file', 'search', 'edit', 'context', 'terminal', 'generateFromTemplate']),
  args: z.unknown(),
});

export const AgentGetHistorySchema = z.object({ sessionId: z.string().min(1) });
export const AgentExportSessionSchema = z.object({ sessionId: z.string().min(1), outPath: z.string().optional() });

export type AgentStartSessionType = z.infer<typeof AgentStartSessionSchema>;
export type AgentExecuteToolType = z.infer<typeof AgentExecuteToolSchema>;
export type AgentGetHistoryType = z.infer<typeof AgentGetHistorySchema>;
export type AgentExportSessionType = z.infer<typeof AgentExportSessionSchema>;

// Agent threads IPC schemas (Phase 1)
export const AgentThreadsListSchema = z.object({
  workspaceId: z.string().optional(),
});

export const AgentThreadsLoadSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const AgentThreadsSaveSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  workspaceId: z.string().optional(),
  messages: z.array(z.unknown()),
  meta: z.object({
    title: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
  }).optional(),
});

export const AgentThreadsDeleteSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const AgentThreadsRenameSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  title: z.string().min(1),
});

export type AgentThreadsListType = z.infer<typeof AgentThreadsListSchema>;
export type AgentThreadsLoadType = z.infer<typeof AgentThreadsLoadSchema>;
export type AgentThreadsSaveSnapshotType = z.infer<typeof AgentThreadsSaveSnapshotSchema>;
export type AgentThreadsDeleteType = z.infer<typeof AgentThreadsDeleteSchema>;
export type AgentThreadsRenameType = z.infer<typeof AgentThreadsRenameSchema>;

// Type exports for TypeScript usage
export type WorkspaceType = z.infer<typeof WorkspaceSchema>;
export type WorkspaceCreateType = z.infer<typeof WorkspaceCreateSchema>;
export type WorkspaceUpdateType = z.infer<typeof WorkspaceUpdateSchema>;
export type FileContentRequestType = z.infer<typeof FileContentRequestSchema>;
export type FileContentResponseType = z.infer<typeof FileContentResponseSchema>;
export type FileSaveType = z.infer<typeof FileSaveSchema>;
export type PreferenceGetType = z.infer<typeof PreferenceGetSchema>;
export type PreferenceSetType = z.infer<typeof PreferenceSetSchema>;
export type PromptType = z.infer<typeof PromptSchema>;
export type InstructionType = z.infer<typeof InstructionSchema>;
export type InstructionCreateType = z.infer<typeof InstructionCreateSchema>;
export type WorkspaceSelectionType = z.infer<typeof WorkspaceSelectionSchema>;
export type WorkspaceSelectionUpdateType = z.infer<typeof WorkspaceSelectionUpdateSchema>;
export type ActivePromptsType = z.infer<typeof ActivePromptsSchema>;
export type AuditLogEntryType = z.infer<typeof AuditLogEntrySchema>;
export type LineRangeType = z.infer<typeof LineRangeSchema>;
export type SelectedFileReferenceType = z.infer<typeof SelectedFileReferenceSchema>;
