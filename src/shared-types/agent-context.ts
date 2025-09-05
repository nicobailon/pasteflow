import { z } from "zod";

// Types
export interface AgentAttachmentMeta {
  path: string;
  lines?: { start: number; end: number } | null;
  tokenCount?: number;
  bytes?: number;
  relativePath?: string;
}

export interface AgentPackedInitial {
  files: AgentAttachmentMeta[];
  prompts: {
    system: { id: string; name: string; tokenCount?: number }[];
    roles?: { id: string; name: string; tokenCount?: number }[];
    instructions?: { id: string; name: string; tokenCount?: number }[];
  };
  user?: { present: boolean; tokenCount: number };
  metadata: { totalTokens: number; signature?: string; timestamp?: number };
}

export interface AgentPackedDynamic { files: AgentAttachmentMeta[] }

export interface AgentContextEnvelope {
  version: 1;
  initial?: AgentPackedInitial;
  dynamic: AgentPackedDynamic;
  workspace?: string | null;
}

export interface AgentContextBody { context: AgentContextEnvelope }

// Zod Schemas (exported for server validation)
export const AgentLineRangeSchema = z
  .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
  .refine((v) => v.end >= v.start, { message: "end must be >= start" });

export const AgentAttachmentMetaSchema = z.object({
  path: z.string().min(1),
  lines: AgentLineRangeSchema.nullish(),
  tokenCount: z.number().int().nonnegative().optional(),
  bytes: z.number().int().nonnegative().optional(),
  relativePath: z.string().optional(),
});

export const AgentPackedInitialSchema = z.object({
  files: z.array(AgentAttachmentMetaSchema),
  prompts: z.object({
    system: z.array(z.object({ id: z.string(), name: z.string(), tokenCount: z.number().int().nonnegative().optional() })),
    roles: z.array(z.object({ id: z.string(), name: z.string(), tokenCount: z.number().int().nonnegative().optional() })).optional(),
    instructions: z.array(z.object({ id: z.string(), name: z.string(), tokenCount: z.number().int().nonnegative().optional() })).optional(),
  }),
  user: z.object({ present: z.boolean(), tokenCount: z.number().int().nonnegative() }).optional(),
  metadata: z.object({ totalTokens: z.number().int().nonnegative(), signature: z.string().optional(), timestamp: z.number().int().optional() }),
});

export const AgentPackedDynamicSchema = z.object({ files: z.array(AgentAttachmentMetaSchema) });

export const AgentContextEnvelopeSchema = z.object({
  version: z.literal(1),
  initial: AgentPackedInitialSchema.optional(),
  dynamic: AgentPackedDynamicSchema,
  workspace: z.string().nullable().optional(),
});

export const AgentContextBodySchema = z.object({ context: AgentContextEnvelopeSchema });

