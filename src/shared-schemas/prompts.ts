import { z } from "zod";

export const SystemPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  tokenCount: z.number().int().optional()
});

export const RolePromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  tokenCount: z.number().int().optional()
});

export const InstructionSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string()
  // DB-layer has created_at/updated_at; keep domain Instruction minimal here
});

