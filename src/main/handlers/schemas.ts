import { z } from 'zod';

import { LineRangeSchema, SelectedFileReferenceSchema } from '../../shared-schemas';
import { AgentContextEnvelopeSchema } from '../../shared-types/agent-context';

// Common request param schemas
export const idParam = z.object({ id: z.string().min(1) });
export const keyParam = z.object({ key: z.string().min(1) });

// Workspaces
export const createWorkspaceBody = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional(),
});
export const updateWorkspaceBody = z.object({
  state: z.record(z.string(), z.unknown()),
});
export const renameBody = z.object({ newName: z.string().min(1).max(255) });

// Instructions
export const instructionBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});

// Preferences
export const prefSetBody = z.object({ value: z.unknown().optional(), encrypted: z.boolean().optional() });

// File path and tokens
export const filePathQuery = z.object({ path: z.string().min(1) });
export const tokensCountBody = z.object({ text: z.string().min(0) });

// Folders
export const foldersOpenBody = z.object({
  folderPath: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});

// Selection
export const selectionItem = SelectedFileReferenceSchema.extend({
  path: SelectedFileReferenceSchema.shape.path.min(1),
  lines: z.array(LineRangeSchema).nonempty().optional(),
});
export const selectionBody = z.object({ items: z.array(selectionItem).min(1) });

// Export content
export const exportBody = z.object({ outputPath: z.string().min(1), overwrite: z.boolean().optional() });

// Preview
export const previewStartBody = z.object({
  includeTrees: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(10_000).optional(),
  maxBytes: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
  prompt: z.string().max(100_000).optional()
});
export const previewIdParam = z.object({ id: z.string().min(1) });

// Chat
export const chatBodySchema = z.object({
  messages: z.array(z.any()),
  context: AgentContextEnvelopeSchema.optional(),
  sessionId: z.string().min(1).optional(),
});

// Models
export const listModelsQuery = z.object({ provider: z.string().optional() });
export const validateModelBody = z.object({
  provider: z.enum(["openai", "anthropic", "openrouter", "groq"] as const),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(200_000).optional(), // Increased to accommodate model-specific limits
});

export { AgentContextEnvelopeSchema };
