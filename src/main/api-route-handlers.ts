import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

import type { Request, Response } from 'express';
import { z } from 'zod';
import { LineRangeSchema, SelectedFileReferenceSchema } from '../shared-schemas';

import { getPathValidator } from '../security/path-validator';
import { getMainTokenService } from '../services/token-service-main';

import { DatabaseBridge } from './db/database-bridge';
import { WorkspaceState, PreferenceValue, ParsedWorkspace } from './db/database-implementation';
import { setAllowedWorkspacePaths, getAllowedWorkspacePaths } from './workspace-context';
import { toApiError, ok } from './error-normalizer';
import { validateAndResolvePath, statFile as fileServiceStatFile, readTextFile } from './file-service';
import { applySelect, applyDeselect } from './selection-service';
import { aggregateSelectedContent } from './content-aggregation';
import { writeExport } from './export-writer';
import { RendererPreviewProxy } from './preview-proxy';
import { PreviewController } from './preview-controller';
import { broadcastToRenderers, broadcastWorkspaceUpdated } from './broadcast-helper';
import { AgentContextEnvelopeSchema } from "../shared-types/agent-context";
import { streamText, convertToModelMessages, consumeStream } from "ai";
import { buildSystemPrompt } from "./agent/system-prompt";
import { getAgentTools } from "./agent/tools";
// secrets handled in provider-specific resolvers

// Schema definitions
export const idParam = z.object({ id: z.string().min(1) });
export const createWorkspaceBody = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional(),
});
export const updateWorkspaceBody = z.object({
  state: z.record(z.string(), z.unknown()),
});
export const renameBody = z.object({ newName: z.string().min(1).max(255) });
export const instructionBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});
export const keyParam = z.object({ key: z.string().min(1) });
export const prefSetBody = z.object({ value: z.unknown().optional(), encrypted: z.boolean().optional() });
export const filePathQuery = z.object({ path: z.string().min(1) });
export const tokensCountBody = z.object({ text: z.string().min(0) });
export const foldersOpenBody = z.object({
  folderPath: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});
export const selectionItem = SelectedFileReferenceSchema.extend({
  path: SelectedFileReferenceSchema.shape.path.min(1),
  lines: z.array(LineRangeSchema).nonempty().optional(),
});
export const selectionBody = z.object({ items: z.array(selectionItem).min(1) });
export const exportBody = z.object({ outputPath: z.string().min(1), overwrite: z.boolean().optional() });
export const previewStartBody = z.object({
  includeTrees: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(10_000).optional(),
  maxBytes: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
  prompt: z.string().max(100_000).optional()
});
export const previewIdParam = z.object({ id: z.string().min(1) });
export const listModelsQuery = z.object({ provider: z.string().optional() });
export const validateModelBody = z.object({
  provider: z.enum(["openai", "anthropic", "openrouter"] as const),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(128_000).optional(),
});

export function mapWorkspaceDbToJson(w: ParsedWorkspace) {
  return {
    id: String(w.id),
    name: w.name,
    folderPath: w.folder_path,
    state: w.state,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    lastAccessed: w.last_accessed,
  };
}

export class APIRouteHandlers {
  constructor(
    private readonly db: DatabaseBridge,
    private readonly previewProxy: RendererPreviewProxy,
    private readonly previewController: PreviewController
  ) {}

  // Health and Status handlers
  async handleHealth(_req: Request, res: Response) {
    return res.json(ok({ status: 'ok' as const }));
  }

  async handleStatus(_req: Request, res: Response) {
    try {
      const activeId = await this.db.getPreference('workspace.active');
      let active: null | { id: string; name: string; folderPath: string } = null;
      const allowedPaths = [...getAllowedWorkspacePaths()];
      let ws: ParsedWorkspace | null = null;
      if (activeId) {
        ws = await this.db.getWorkspace(String(activeId));
        if (ws) {
          active = { id: String(ws.id), name: ws.name, folderPath: ws.folder_path };
        }
      }
      if (allowedPaths.length === 0 && ws?.folder_path) {
        allowedPaths.push(ws.folder_path);
      }
      return res.json(ok({ status: 'running', activeWorkspace: active, securityContext: { allowedPaths } }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Workspace handlers
  async handleListWorkspaces(_req: Request, res: Response) {
    try {
      const rows = await this.db.listWorkspaces();
      const data = rows.map(mapWorkspaceDbToJson);
      return res.json(ok(data));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Models: list available models (static catalog with optional dynamic in future)
  async handleListModels(req: Request, res: Response) {
    try {
      const parsed = listModelsQuery.safeParse(req.query);
      const { resolveAgentConfig } = await import('./agent/config');
      const cfg = await resolveAgentConfig(this.db as unknown as { getPreference: (k: string) => Promise<unknown> });
      const providerParam = parsed.success && typeof parsed.data.provider === 'string' ? parsed.data.provider.toLowerCase() : null;
      const provider = (providerParam === 'openai' || providerParam === 'anthropic' || providerParam === 'openrouter') ? providerParam : (cfg as any).PROVIDER || 'openai';
      const { getStaticModels } = await import('./agent/models-catalog');
      const models = getStaticModels(provider as any);
      return res.json(ok({ provider, models }));
    } catch (error) {
      return res.status(500).json(toApiError('SERVER_ERROR', (error as Error)?.message || 'Failed to list models'));
    }
  }

  // Models: validate a provider+model by issuing a tiny call
  async handleValidateModel(req: Request, res: Response) {
    const body = validateModelBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request body'));
    const { provider, model, apiKey, baseUrl, temperature, maxOutputTokens } = body.data;
    try {
      // Resolve model with provided overrides when present
      const { createOpenAI } = await import('@ai-sdk/openai');
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const { generateText } = await import('ai');
      const { loadProviderCredentials } = await import('./agent/model-resolver');

      // Load stored credentials when not provided explicitly
      const creds = await loadProviderCredentials(this.db as unknown as { getPreference: (k: string) => Promise<unknown> });

      let lm: any;
      if (provider === 'openai') {
        const client = createOpenAI({ apiKey: apiKey || creds.openai?.apiKey || undefined });
        lm = client(model);
      } else if (provider === 'anthropic') {
        const client = createAnthropic({ apiKey: apiKey || creds.anthropic?.apiKey || undefined });
        lm = client(model);
      } else {
        // openrouter uses OpenAI-compatible client with baseURL
        const client = createOpenAI({ apiKey: apiKey || creds.openrouter?.apiKey || undefined, baseURL: baseUrl || creds.openrouter?.baseUrl || 'https://openrouter.ai/api/v1' });
        lm = client(model);
      }

      // Minimal cost validation: 1 token output, tiny prompt
      await generateText({
        model: lm,
        prompt: 'ping',
        maxOutputTokens: Math.max(1, Math.min(10, Number(maxOutputTokens || 1))),
        temperature: typeof temperature === 'number' ? temperature : 0,
      });

      return res.json(ok({ ok: true }));
    } catch (error) {
      const msg = (error as Error)?.message || 'Validation failed';
      return res.json(ok({ ok: false, error: msg }));
    }
  }

  async handleCreateWorkspace(req: Request, res: Response) {
    const parsed = createWorkspaceBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    try {
      const created = await this.db.createWorkspace(
        parsed.data.name,
        parsed.data.folderPath,
        (parsed.data.state ?? {}) as Partial<WorkspaceState>
      );
      // Notify renderers that the workspaces list changed
      broadcastToRenderers('workspaces-updated');
      return res.json(ok(mapWorkspaceDbToJson(created)));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleGetWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      const ws = await this.db.getWorkspace(params.data.id);
      if (!ws) return res.json(ok(null));
      return res.json(ok(mapWorkspaceDbToJson(ws)));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleUpdateWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = updateWorkspaceBody.safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      await this.db.updateWorkspaceById(params.data.id, body.data.state as Partial<WorkspaceState>);
      // Best-effort: broadcast updated state to renderer windows for immediate UI sync
      try {
        const ws = await this.db.getWorkspace(params.data.id);
        if (ws) {
          broadcastWorkspaceUpdated({
            workspaceId: String(ws.id),
            folderPath: ws.folder_path,
            selectedFiles: (ws.state?.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[],
          });
        }
      } catch {
        // ignore broadcast errors
      }
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleDeleteWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.deleteWorkspaceById(params.data.id);
      // Notify renderers that the workspaces list changed
      broadcastToRenderers('workspaces-updated');
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Chat streaming (Phase 2 prerequisite)
  async handleChat(req: Request, res: Response) {
    try {
      const ChatBodySchema = z.object({
        messages: z.array(z.any()),
        context: AgentContextEnvelopeSchema.optional(),
        sessionId: z.string().min(1).optional(),
      });
      const parsed = ChatBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      }

      const uiMessages = parsed.data.messages as any[];
      let modelMessages: any[];
      try {
        modelMessages = convertToModelMessages(uiMessages);
      } catch (e) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid chat messages format'));
      }

      // Derive or generate session id
      const headerSession = String((req.headers['x-pasteflow-session'] || req.headers['x-pf-session-id'] || '')).trim();
      const sessionId = parsed.data.sessionId || (headerSession || randomUUID());

      // Sanitize/normalize context
      const envelope = parsed.data.context;
      const allowed = getAllowedWorkspacePaths();
      const safeEnvelope = envelope ? this.sanitizeContextEnvelope(envelope as any, allowed) : undefined;

      const system = buildSystemPrompt({
        initial: safeEnvelope?.initial,
        dynamic: safeEnvelope?.dynamic ?? { files: [] },
        workspace: safeEnvelope?.workspace ?? null,
      });

      // Cancellation wiring: abort tools on client disconnect
      const controller = new AbortController();
      const onAbort = () => { try { controller.abort(); } catch {} };
      req.on('aborted', onAbort);
      res.on('close', onAbort);

      // Resolve config + security manager and wrap tools with execution logger
      const { resolveAgentConfig } = await import('./agent/config');
      const cfg = await resolveAgentConfig(this.db as unknown as { getPreference: (k: string) => Promise<unknown> });
      const { AgentSecurityManager } = await import('./agent/security-manager');
      const security = await AgentSecurityManager.create({ db: this.db as unknown as { getPreference: (k: string) => Promise<unknown> } });
      const tools = getAgentTools({
        signal: controller.signal,
        security,
        config: cfg,
        sessionId,
        onToolExecute: async (name, args, result, meta) => {
          try {
            await this.db.insertToolExecution({
              sessionId,
              toolName: String(name),
              args,
              result,
              status: 'ok',
              error: null,
              startedAt: (meta as any)?.startedAt ?? null,
              durationMs: (meta as any)?.durationMs ?? null,
            });
          } catch {
            // ignore logging errors
          }
        },
      });

      // Backpressure guard: if session is currently rate-limited, return 429
      try {
        if (typeof (security as any)?.isRateLimited === 'function' && (security as any).isRateLimited(sessionId)) {
          return res.status(429).json(toApiError('RATE_LIMITED', 'Too many tool calls in the last minute'));
        }
      } catch { /* ignore guard errors */ }

      // Resolve model for current provider + model id
      const { resolveModelForRequest } = await import('./agent/model-resolver');
      const provider = (cfg as any).PROVIDER || 'openai';
      const { model } = await resolveModelForRequest({ db: this.db as unknown as { getPreference: (k: string) => Promise<unknown> }, provider: provider as any, modelId: cfg.DEFAULT_MODEL });

      // Dev-only: log tool param kinds to ensure proper schema wiring
      try {
        if (process.env.NODE_ENV === 'development') {
          const snap: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(tools as any)) {
            // Prefer inputSchema (AI SDK v5), fallback to legacy parameters for dev insight only
            const schema: any = (v as any)?.inputSchema || (v as any)?.parameters;
            const tag = schema && typeof schema === 'object'
              ? (schema?.jsonSchema?.type || schema?._def?.typeName || schema?.type || Object.prototype.toString.call(schema))
              : typeof schema;
            snap[k] = tag;
          }
          // eslint-disable-next-line no-console
          console.log('[AI] tool parameter kinds:', snap);
        }
      } catch { /* noop */ }

      const disableTools = String(process.env.PF_AGENT_DISABLE_TOOLS || '').toLowerCase() === 'true';
      const result = streamText({
        model,
        system,
        messages: modelMessages,
        tools: disableTools ? undefined : tools,
        temperature: (cfg as any).TEMPERATURE ?? undefined,
        maxOutputTokens: (cfg as any).MAX_OUTPUT_TOKENS ?? undefined,
        abortSignal: controller.signal,
        onAbort: () => {
          // Best-effort: nothing to persist yet; hook kept for future telemetry
        },
      });

      // Pipe to Express response with UI_MESSAGE_STREAM headers and consume stream on abort to avoid hangs
      result.pipeUIMessageStreamToResponse(res, {
        consumeSseStream: consumeStream,
      });

      // Persist/refresh session shell with last known messages snapshot (cap messages)
      try {
        const maxMsgs = Number(process.env.PF_AGENT_MAX_SESSION_MESSAGES ?? 50);
        const msgJson = JSON.stringify(Array.isArray(uiMessages) ? uiMessages.slice(-Math.max(1, maxMsgs)) : uiMessages);
        const activeId = await this.db.getPreference('workspace.active');
        const ws = activeId ? await this.db.getWorkspace(String(activeId)) : null;
        await this.db.upsertChatSession(sessionId, msgJson, ws ? String(ws.id) : null);
      } catch { /* ignore */ }

      // Best-effort write a usage row (token metrics TBD)
      try {
        await this.db.insertUsageSummary(sessionId, null, null, null);
      } catch { /* noop */ }
    } catch (error) {
      // Graceful fallback: invalid tool parameter schema → retry once without tools
      if (this.isInvalidToolParametersError(error)) {
        try {
          // eslint-disable-next-line no-console
          console.warn("[AI] Tool schema invalid; retrying without tools");

          // Re-parse request and rebuild minimal call params
          const ChatBodySchema = z.object({
            messages: z.array(z.any()),
            context: AgentContextEnvelopeSchema.optional(),
            sessionId: z.string().min(1).optional(),
          });
          const parsed = ChatBodySchema.safeParse(req.body);
          if (!parsed.success) {
            return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
          }

          let modelMessages: any[];
          try {
            modelMessages = convertToModelMessages(parsed.data.messages as any[]);
          } catch {
            return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid chat messages format'));
          }

          const headerSession = String((req.headers['x-pasteflow-session'] || req.headers['x-pf-session-id'] || '')).trim();
          const sessionId = parsed.data.sessionId || (headerSession || randomUUID());

          const envelope = parsed.data.context;
          const allowed = getAllowedWorkspacePaths();
          const safeEnvelope = envelope ? this.sanitizeContextEnvelope(envelope as any, allowed) : undefined;
          const system = buildSystemPrompt({
            initial: safeEnvelope?.initial,
            dynamic: safeEnvelope?.dynamic ?? { files: [] },
            workspace: safeEnvelope?.workspace ?? null,
          });

          const controller = new AbortController();
          const onAbort = () => { try { controller.abort(); } catch {} };
          req.on('aborted', onAbort);
          res.on('close', onAbort);

          const { resolveAgentConfig } = await import('./agent/config');
          const cfg = await resolveAgentConfig(this.db as unknown as { getPreference: (k: string) => Promise<unknown> });

          const { resolveModelForRequest } = await import('./agent/model-resolver');
          const provider = (cfg as any).PROVIDER || 'openai';
          const { model } = await resolveModelForRequest({ db: this.db as unknown as { getPreference: (k: string) => Promise<unknown> }, provider: provider as any, modelId: cfg.DEFAULT_MODEL });

          const result = streamText({
            model,
            system,
            messages: modelMessages,
            tools: undefined, // retry without tools
            temperature: (cfg as any).TEMPERATURE ?? undefined,
            maxOutputTokens: (cfg as any).MAX_OUTPUT_TOKENS ?? undefined,
            abortSignal: controller.signal,
            onAbort: () => {},
          });

          result.pipeUIMessageStreamToResponse(res, { consumeSseStream: consumeStream });

          try {
            const maxMsgs = Number(process.env.PF_AGENT_MAX_SESSION_MESSAGES ?? 50);
            const msgJson = JSON.stringify(Array.isArray(parsed.data.messages) ? parsed.data.messages.slice(-Math.max(1, maxMsgs)) : parsed.data.messages);
            const activeId = await this.db.getPreference('workspace.active');
            const ws = activeId ? await this.db.getWorkspace(String(activeId)) : null;
            await this.db.upsertChatSession(sessionId, msgJson, ws ? String(ws.id) : null);
          } catch { /* ignore */ }

          try {
            await this.db.insertUsageSummary(sessionId, null, null, null);
          } catch { /* noop */ }

          return; // streamed response
        } catch (fallbackError) {
          // If fallback fails, continue with existing error mapping below
          error = fallbackError;
        }
      }
      // Classify provider config issues (missing/invalid keys)
      if (this.isProviderConfigError(error) || this.isAuthError(error)) {
        try { console.warn('AI provider config error or auth failure'); } catch { /* noop */ }
        let providerName = 'openai';
        try {
          const { resolveAgentConfig } = await import('./agent/config');
          const cfg2 = await resolveAgentConfig(this.db as unknown as { getPreference: (k: string) => Promise<unknown> });
          providerName = (cfg2 as any).PROVIDER || 'openai';
        } catch { /* noop */ }
        return res
          .status(503)
          .json(
            toApiError('AI_PROVIDER_CONFIG', 'AI provider credentials missing or invalid', {
              provider: providerName,
              reason: this.isProviderConfigError(error) ? 'credentials-missing' : 'unauthorized',
            })
          );
      }

      // Invalid/unknown model id → 400 surfaced to UI as user-fixable
      if (this.isInvalidModelError(error)) {
        const modelId = (await import('./agent/config')).resolveAgentConfig(this.db as any).then(c => (c as any).DEFAULT_MODEL).catch(() => undefined);
        const resolved = await Promise.resolve(modelId).catch(() => undefined);
        return res.status(400).json(
          toApiError('AI_INVALID_MODEL', 'Selected model is not available', {
            model: resolved || undefined,
          })
        );
      }

      // If provider exposes an HTTP status, forward when sensible (e.g., 429)
      const status = this.getStatusFromAIError(error);
      if (status && status >= 400 && status <= 599) {
        return res.status(status).json(toApiError(status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', (error as Error)?.message || 'Request failed'));
      }

      const message = (error as Error)?.message || 'Unknown error';
      return res.status(500).json(toApiError('SERVER_ERROR', message));
    }
  }

  // Helper: sanitize context envelope
  private sanitizeContextEnvelope(envelope: any, allowed: readonly string[]) {
    try {
      if (!envelope || !Array.isArray(allowed) || allowed.length === 0) return envelope;
      const nodePath = require('node:path') as typeof import('node:path');
      const safeFiles = (files: any[]) => {
        const out: any[] = [];
        for (const f of Array.isArray(files) ? files : []) {
          const p = String(f?.path || '');
          // Ensure under allowed roots
          const isAllowed = allowed.some((root) => {
            try {
              const rel = nodePath.relative(root, p);
              return rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
            } catch { return false; }
          });
          if (!isAllowed) continue;
          const rel = (() => {
            for (const root of allowed) {
              try {
                const r = nodePath.relative(root, p);
                if (r && !r.startsWith('..') && !nodePath.isAbsolute(r)) return r;
              } catch { /* noop */ }
            }
            return undefined;
          })();
          out.push({
            path: p,
            lines: f?.lines ?? null,
            tokenCount: typeof f?.tokenCount === 'number' ? f.tokenCount : undefined,
            bytes: typeof f?.bytes === 'number' ? f.bytes : undefined,
            relativePath: rel,
          });
          if (out.length >= 50) break;
        }
        return out;
      };

      const initial = envelope.initial ? {
        files: safeFiles(envelope.initial.files || []),
        prompts: {
          system: Array.isArray(envelope.initial.prompts?.system) ? envelope.initial.prompts.system.slice(0, 50) : [],
          roles: Array.isArray(envelope.initial.prompts?.roles) ? envelope.initial.prompts.roles.slice(0, 50) : [],
          instructions: Array.isArray(envelope.initial.prompts?.instructions) ? envelope.initial.prompts.instructions.slice(0, 50) : [],
        },
        user: envelope.initial.user && typeof envelope.initial.user.tokenCount === 'number'
          ? { present: Boolean(envelope.initial.user.present), tokenCount: envelope.initial.user.tokenCount }
          : undefined,
        metadata: {
          totalTokens: typeof envelope.initial.metadata?.totalTokens === 'number' ? envelope.initial.metadata.totalTokens : 0,
          signature: envelope.initial.metadata?.signature,
          timestamp: envelope.initial.metadata?.timestamp,
        },
      } : undefined;

      const dynamic = { files: safeFiles(envelope.dynamic?.files || []) };
      const workspace = typeof envelope.workspace === 'string' ? envelope.workspace : null;

      return { version: 1 as const, initial, dynamic, workspace };
    } catch {
      return envelope;
    }
  }

  async handleRenameWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = renameBody.safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      const ws = await this.db.getWorkspace(params.data.id);
      if (!ws) return res.status(404).json(toApiError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
      await this.db.renameWorkspace(ws.name, body.data.newName);
      // Notify renderers that the workspaces list changed
      broadcastToRenderers('workspaces-updated');
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleLoadWorkspace(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.setPreference('workspace.active', params.data.id);
      const ws = await this.db.getWorkspace(params.data.id);
      if (ws?.folder_path) {
        setAllowedWorkspacePaths([ws.folder_path]);
        getPathValidator([ws.folder_path]);
        // Best-effort: notify all renderer windows to open this folder and apply selection state
        broadcastToRenderers('folder-selected', ws.folder_path);
        broadcastWorkspaceUpdated({
          workspaceId: String(ws.id),
          folderPath: ws.folder_path,
          selectedFiles: (ws.state?.selectedFiles ?? []) as { path: string; lines?: { start: number; end: number }[] }[],
        });
      }
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Instruction handlers
  async handleListInstructions(_req: Request, res: Response) {
    try {
      const rows = await this.db.listInstructions();
      const data = rows.map((i) => ({
        id: i.id,
        name: i.name,
        content: i.content,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      }));
      return res.json(ok(data));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleCreateInstruction(req: Request, res: Response) {
    const body = instructionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    const id = body.data.id ?? randomUUID();
    try {
      await this.db.createInstruction(id, body.data.name, body.data.content);
      // Notify renderers that instruction set changed
      broadcastToRenderers('instructions-updated');
      return res.json(ok({ id, name: body.data.name, content: body.data.content }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleUpdateInstruction(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
    if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    try {
      await this.db.updateInstruction(params.data.id, body.data.name, body.data.content);
      // Notify renderers that instruction set changed
      broadcastToRenderers('instructions-updated');
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleDeleteInstruction(req: Request, res: Response) {
    const params = idParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
    try {
      await this.db.deleteInstruction(params.data.id);
      // Notify renderers that instruction set changed
      broadcastToRenderers('instructions-updated');
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Preference handlers
  async handleGetPreference(req: Request, res: Response) {
    const params = keyParam.safeParse(req.params);
    if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid key'));
    try {
      const value = await this.db.getPreference(params.data.key);
      return res.json(ok(value ?? null));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleSetPreference(req: Request, res: Response) {
    const params = keyParam.safeParse(req.params);
    const body = prefSetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
    }
    try {
      const val = body.data.value ?? null;
      const enc = body.data.encrypted === true;
      let toStore: PreferenceValue = val as PreferenceValue;
      if (enc && typeof val === 'string' && val.trim().length > 0) {
        // Store as encrypted secret blob
        const { encryptSecret } = await import('./secret-prefs');
        toStore = encryptSecret(val);
      }
      await this.db.setPreference(params.data.key, toStore as PreferenceValue);
      // Notify renderers to refresh cached preferences
      broadcastToRenderers('/prefs/get:update');
      return res.json(ok(true));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // File handlers
  async handleFileInfo(req: Request, res: Response) {
    const validation = await this.validateFilePath(req, res);
    if (!validation) return;

    const s = await fileServiceStatFile(validation.absolutePath);
    if (!s.ok) {
      return this.handleFileError(s, res);
    }
    return res.json(ok(s.data));
  }

  async handleFileContent(req: Request, res: Response) {
    const validation = await this.validateFilePath(req, res);
    if (!validation) return;

    const s = await fileServiceStatFile(validation.absolutePath);
    if (!s.ok) {
      return this.handleFileError(s, res);
    }

    if (s.data.isDirectory) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is a directory'));
    }
    if (s.data.isBinary) {
      return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
    }

    const r = await readTextFile(validation.absolutePath);
    if (!r.ok) {
      return this.handleReadError(r, res);
    }

    if (r.isLikelyBinary) {
      return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
    }

    const tokenService = getMainTokenService();
    const { count } = await tokenService.countTokens(r.content);
    return res.json(ok({ content: r.content, tokenCount: count, fileType: s.data.fileType || 'plaintext' }));
  }

  // Token handlers
  async handleCountTokens(req: Request, res: Response) {
    const body = tokensCountBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    try {
      const tokenService = getMainTokenService();
      const result = await tokenService.countTokens(body.data.text);
      return res.json(ok(result));
    } catch (error) {
      return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
    }
  }

  async handleGetTokenBackend(_req: Request, res: Response) {
    try {
      const tokenService = getMainTokenService();
      const backend = await tokenService.getActiveBackend();
      return res.json(ok({ backend: backend ?? 'estimate' }));
    } catch (error) {
      return res.status(500).json(toApiError('INTERNAL_ERROR', (error as Error).message));
    }
  }

  // Folder handlers
  async handleGetCurrentFolder(_req: Request, res: Response) {
    try {
      const activeId = await this.db.getPreference('workspace.active');
      if (!activeId) return res.json(ok(null));
      const ws = await this.db.getWorkspace(String(activeId));
      if (!ws) return res.json(ok(null));
      return res.json(ok({ folderPath: ws.folder_path }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  async handleOpenFolder(req: Request, res: Response) {
    const body = foldersOpenBody.safeParse(req.body);
    if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    
    try {
      const folderPath = String(body.data.folderPath);
      const validation = await this.validateFolderPath(folderPath);
      if (!validation.isValid) {
        return res.status(400).json(toApiError('VALIDATION_ERROR', validation.message));
      }

      const workspace = await this.findOrCreateWorkspace(folderPath, body.data.name);
      if (workspace.error) {
        return res.status(workspace.status).json(toApiError(workspace.code, workspace.message));
      }

      // TypeScript now knows workspace.error is false, so workspace.data exists
      const { data } = workspace;
      await this.activateWorkspace(data);

      // Best-effort: notify all renderer windows to open this folder
      broadcastToRenderers('folder-selected', data.folder_path);

      return res.json(ok({ 
        id: String(data.id), 
        name: data.name, 
        folderPath: data.folder_path 
      }));
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Agent: export session (Phase 4)
  async handleAgentExportSession(req: Request, res: Response) {
    const Body = z.object({ id: z.string().min(1), outPath: z.string().optional(), download: z.boolean().optional() });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    try {
      const id = parsed.data.id;
      const row = await this.db.getChatSession(id);
      if (!row) return res.status(404).json(toApiError('NOT_FOUND', 'Session not found'));
      const tools = await this.db.listToolExecutions(id);
      const usage = await this.db.listUsageSummaries(id);
      const payload = { session: row, toolExecutions: tools, usage };
      const outPath = parsed.data.outPath;
      // If caller wants JSON directly, return without writing
      if (parsed.data.download === true) {
        return res.json(ok(payload));
      }
      if (outPath && outPath.trim().length > 0) {
        const val = validateAndResolvePath(outPath);
        if (!val.ok) return this.handlePathValidationError(val, res);
        await fs.promises.writeFile(val.absolutePath, JSON.stringify(payload, null, 2), 'utf8');
        return res.json(ok({ file: val.absolutePath }));
      }
      // Default: write to Downloads folder
      try {
        const { app } = require('electron') as typeof import('electron');
        const file = path.join(app.getPath('downloads'), `pasteflow-session-${id}.json`);
        await fs.promises.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
        return res.json(ok({ file }));
      } catch {
        // Fallback to returning JSON if electron path resolution fails in unusual environments
        return res.json(ok(payload));
      }
    } catch (error) {
      return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
    }
  }

  // Helper methods
  private async validateFilePath(req: Request, res: Response) {
    const q = filePathQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid query'));
      return null;
    }

    const allowed = getAllowedWorkspacePaths();
    if (!allowed || allowed.length === 0) {
      res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
      return null;
    }

    const val = validateAndResolvePath(String(q.data.path));
    if (!val.ok) {
      this.handlePathValidationError(val, res);
      return null;
    }

    return val;
  }

  private handlePathValidationError(val: { ok: false; code: string; message: string }, res: Response) {
    if (val.code === 'NO_ACTIVE_WORKSPACE') {
      res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
    } else if (val.code === 'PATH_DENIED') {
      res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
    } else {
      res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
    }
  }

  private handleFileError(s: { ok: false; code: string; message: string }, res: Response) {
    if (s.code === 'FILE_NOT_FOUND') {
      return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
    }
    if (s.code === 'FILE_SYSTEM_ERROR') {
      return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', s.message));
    }
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', s.message));
  }

  private handleReadError(r: { ok: false; code: string; message: string }, res: Response) {
    if (r.code === 'FILE_NOT_FOUND') {
      return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
    }
    if (r.code === 'BINARY_FILE') {
      return res.status(409).json(toApiError('BINARY_FILE', r.message));
    }
    if (r.code === 'VALIDATION_ERROR') {
      return res.status(400).json(toApiError('VALIDATION_ERROR', r.message));
    }
    if (r.code === 'FILE_SYSTEM_ERROR') {
      return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', r.message));
    }
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', r.message));
  }

  private async validateFolderPath(folderPath: string) {
    try {
      const st = await fs.promises.stat(folderPath);
      if (!st.isDirectory()) {
        return { isValid: false, message: 'Path is not a directory' };
      }
      return { isValid: true, message: '' };
    } catch {
      return { isValid: false, message: 'Folder does not exist' };
    }
  }

  private async findOrCreateWorkspace(folderPath: string, name?: string): Promise<
    | { error: true; status: number; code: 'VALIDATION_ERROR'; message: string }
    | { error: false; data: ParsedWorkspace }
  > {
    const workspaces = await this.db.listWorkspaces();
    let ws = workspaces.find((w) => w.folder_path === folderPath);

    if (!ws) {
      const requestedName = name ?? (path.basename(folderPath) || `workspace-${randomUUID().slice(0, 8)}`);
      const collision = workspaces.find((w) => w.name === requestedName && w.folder_path !== folderPath);
      
      if (collision && name) {
        return { 
          error: true, 
          status: 409, 
          code: 'VALIDATION_ERROR' as const, 
          message: `Workspace name '${requestedName}' already exists` 
        };
      }
      
      const effectiveName = collision && !name ? `${requestedName}-${randomUUID().slice(0, 6)}` : requestedName;
      ws = await this.db.createWorkspace(effectiveName, folderPath, {} as WorkspaceState);
    }

    return { error: false, data: ws };
  }

  private async activateWorkspace(workspace: ParsedWorkspace) {
    await this.db.setPreference('workspace.active', String(workspace.id));
    setAllowedWorkspacePaths([workspace.folder_path]);
    getPathValidator([workspace.folder_path]);
  }

  // Detect provider configuration errors (e.g., missing API key)
  private isProviderConfigError(err: unknown): boolean {
    try {
      const anyErr = err as any;
      const name = String(anyErr?.name || '');
      const msg = String(anyErr?.message || '').toLowerCase();
      if (name === 'AI_LoadAPIKeyError') return true;
      if (name.includes('LoadAPIKeyError')) return true;
      if (msg.includes('api key is missing')) return true;
      return false;
    } catch {
      return false;
    }
  }

  // Treat 401/403 as auth/provider config issues to surface a Configure banner
  private isAuthError(err: unknown): boolean {
    try {
      const anyErr = err as any;
      const status = Number(anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status ?? anyErr?.cause?.status);
      if (status === 401 || status === 403) return true;
      const msg = String(anyErr?.message || '').toLowerCase();
      return msg.includes('unauthorized') || msg.includes('invalid api key');
    } catch { return false; }
  }

  // Detect invalid/unknown model errors across providers
  private isInvalidModelError(err: unknown): boolean {
    try {
      const anyErr = err as any;
      const status = Number(anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status ?? anyErr?.cause?.status);
      if (status === 404) return true;
      const msg = String(anyErr?.message || '').toLowerCase();
      if (msg.includes('model_not_found')) return true;
      if (msg.includes('model') && msg.includes('does not exist')) return true;
      if (msg.includes('unknown model') || msg.includes('invalid model')) return true;
      return false;
    } catch { return false; }
  }

  // Extract a provider-supplied HTTP status, if any
  private getStatusFromAIError(err: unknown): number | null {
    try {
      const anyErr = err as any;
      const status = Number(anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status ?? anyErr?.cause?.status);
      if (Number.isFinite(status)) return status;
      const msg = String(anyErr?.message || '').toLowerCase();
      if (/(?:^|\b)(429|too many requests)(?:\b|$)/.test(msg)) return 429;
      return null;
    } catch { return null; }
  }

  // Detect invalid tool schema/parameters errors (e.g., OpenAI Responses API)
  private isInvalidToolParametersError(err: unknown): boolean {
    try {
      const anyErr = err as any;
      const msg = String(anyErr?.message || '').toLowerCase();
      const code = String(anyErr?.code || anyErr?.data?.error?.code || '').toLowerCase();
      const param = String(anyErr?.param || anyErr?.data?.error?.param || '').toLowerCase();
      if (code.includes('invalid_function_parameters')) return true;
      if (msg.includes('invalid_function_parameters')) return true;
      if (msg.includes('parameters must be json schema type') && (param.includes('tools') || msg.includes('tools'))) return true;
      return false;
    } catch { return false; }
  }
}
