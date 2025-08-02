import { z } from 'zod';

// Workspace schemas
export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastAccessed: z.number()
});

export const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.unknown()).optional()
});

export const WorkspaceUpdateSchema = z.object({
  id: z.string().uuid(),
  state: z.record(z.unknown())
});

// File schemas
export const FileContentRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  filePath: z.string(),
  lineRanges: z.array(z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive()
  })).optional()
});

export const FileContentResponseSchema = z.object({
  content: z.string(),
  tokenCount: z.number().int(),
  hash: z.string(),
  compressed: z.boolean()
});

export const FileSaveSchema = z.object({
  workspaceId: z.string().uuid(),
  filePath: z.string(),
  content: z.string(),
  tokenCount: z.number().int().optional()
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
  category: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const InstructionCreateSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string(),
  category: z.string().optional()
});

// Workspace selection schemas
export const WorkspaceSelectionSchema = z.object({
  selectedFiles: z.array(z.object({
    path: z.string(),
    lines: z.array(z.object({
      start: z.number().int().positive(),
      end: z.number().int().positive()
    })).optional(),
    content: z.string().optional(),
    tokenCount: z.number().int().optional(),
    isFullFile: z.boolean().optional(),
    isContentLoaded: z.boolean().optional()
  })),
  lastModified: z.number()
});

export const WorkspaceSelectionUpdateSchema = z.object({
  selectedFiles: z.array(z.object({
    path: z.string(),
    lines: z.array(z.object({
      start: z.number().int().positive(),
      end: z.number().int().positive()
    })).optional(),
    content: z.string().optional(),
    tokenCount: z.number().int().optional(),
    isFullFile: z.boolean().optional(),
    isContentLoaded: z.boolean().optional()
  })),
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
export type PromptType = z.infer<typeof PromptSchema>;
export type InstructionType = z.infer<typeof InstructionSchema>;
export type InstructionCreateType = z.infer<typeof InstructionCreateSchema>;
export type WorkspaceSelectionType = z.infer<typeof WorkspaceSelectionSchema>;
export type WorkspaceSelectionUpdateType = z.infer<typeof WorkspaceSelectionUpdateSchema>;
export type ActivePromptsType = z.infer<typeof ActivePromptsSchema>;
export type AuditLogEntryType = z.infer<typeof AuditLogEntrySchema>;