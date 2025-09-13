import { randomUUID } from 'node:crypto';
import nodePath from 'node:path';

import type { Request, Response } from 'express';
import { streamText, convertToModelMessages, consumeStream } from 'ai';
import type { UIMessage, ModelMessage, ToolSet } from 'ai';

import { toApiError } from '../error-normalizer';
import { getAllowedWorkspacePaths } from '../workspace-context';
import { composeEffectiveSystemPrompt } from '../agent/system-prompt';
import { getAgentTools } from '../agent/tools';
import { getEnabledToolsSet } from '../agent/tools-config';
import type { ContextResult } from '../agent/tool-types';
import type { ProviderId } from '../agent/models-catalog';
import { withRateLimitRetries } from '../utils/retry';
import type { DatabaseBridge } from '../db/database-bridge';
import type { RendererPreviewProxy } from '../preview-proxy';
import type { PreviewController } from '../preview-controller';
import type { AgentContextEnvelope } from '../../shared-types/agent-context';
import { chatBodySchema } from './schemas';

// --- Logging helpers (non-invasive, dev-friendly) ---
function clipLog(s: unknown, max = 200): string {
  try {
    const str = String(s ?? '');
    return str.length > max ? str.slice(0, max) + '…' : str;
  } catch { return ''; }
}

function extractLastUserText(messages: ModelMessage[]): string | null {
  try {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user') {
        const parts = Array.isArray(m.content) ? m.content : [];
        for (let j = parts.length - 1; j >= 0; j--) {
          const p = parts[j] as { type?: string; text?: string } | null | undefined;
          if (p && p.type === 'text' && typeof p.text === 'string') return p.text;
        }
      }
    }
    return null;
  } catch { return null; }
}

function isToolAvailabilityQuery(text: string | null | undefined): boolean {
  try {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
      /\bwhich\b.*\btools\b.*\b(avail|have)\b/.test(t) ||
      /\bwhat\b.*\btools\b.*\b(avail|can you use|have)\b/.test(t) ||
      /\btools?\b.*\bavailable\b/.test(t)
    );
  } catch {
    return false;
  }
}

export type HandlerDeps = {
  db: DatabaseBridge;
  previewProxy: RendererPreviewProxy;
  previewController: PreviewController;
};

export async function handleChat(deps: HandlerDeps, req: Request, res: Response) {
  try {
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
    }

    const uiMessages = parsed.data.messages as Omit<UIMessage, 'id'>[];
    let modelMessages: ModelMessage[];
    try {
      modelMessages = convertToModelMessages(uiMessages);
    } catch (e) {
      try { console.warn('[AI][chat] invalid messages format'); } catch { /* noop */ }
      return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid chat messages format'));
    }

    if (res.headersSent) return;

    const _headers = (req.headers ?? {}) as Record<string, unknown>;
    const headerSession = String(((_headers['x-pasteflow-session'] as unknown) || (_headers['x-pf-session-id'] as unknown) || '')).trim();
    const sessionId = parsed.data.sessionId || (headerSession || randomUUID());

    const lastUser = extractLastUserText(modelMessages);
    if (isToolAvailabilityQuery(lastUser)) {
      try { console.log('[AI][chat] tool-availability-query detected'); } catch { /* noop */ }
    }

    const envelope = parsed.data.context;
    const allowed = getAllowedWorkspacePaths();
    const safeEnvelope = envelope ? sanitizeContextEnvelope(envelope, allowed) : undefined;

    // Read enabled tools (for both system composition and tool filtering)
    const enabledTools = await getEnabledToolsSet(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
    const system = await composeEffectiveSystemPrompt(
      deps.db as unknown as { getPreference: (k: string) => Promise<unknown> },
      {
        initial: safeEnvelope?.initial,
        dynamic: safeEnvelope?.dynamic ?? { files: [] },
        workspace: safeEnvelope?.workspace ?? null,
      },
      { enabledTools }
    );

    try {
      const initCount = safeEnvelope?.initial?.files?.length ?? 0;
      const dynCount = safeEnvelope?.dynamic?.files?.length ?? 0;
      const ws = safeEnvelope?.workspace ?? null;
      const previewText = clipLog(lastUser, 160);
      console.log('[AI][chat:start]', { sessionId, messages: uiMessages?.length ?? 0, lastUser: previewText, context: { initialFiles: initCount, dynamicFiles: dynCount, workspace: ws } });
    } catch { /* noop */ }

    // Cancellation wiring
    const controller = new AbortController();
    const onAbort = () => { try { controller.abort(); } catch { /* noop */ } };
    req.on('aborted', onAbort);
    res.on('close', onAbort);

    try {
      res.on('finish', () => {
        try { console.log('[AI][chat:response:finish]', { sessionId, status: res.statusCode }); } catch { /* noop */ }
      });
      res.on('close', () => {
        try { console.log('[AI][chat:response:close]', { sessionId }); } catch { /* noop */ }
      });
    } catch { /* noop */ }

    // Resolve config, tools and security
    const { resolveAgentConfig } = await import('../agent/config');
    const cfg = await resolveAgentConfig(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
    const { AgentSecurityManager } = await import('../agent/security-manager');
    const security = await AgentSecurityManager.create({ db: deps.db as unknown as { getPreference: (k: string) => Promise<unknown> } });
    const toolsAll = getAgentTools({
      signal: controller.signal,
      security,
      config: cfg,
      sessionId,
      onToolExecute: async (name, args, result, meta) => {
        try {
          const typedResult = name === 'context' ? (result as ContextResult) : result;
          await deps.db.insertToolExecution({
            sessionId,
            toolName: String(name),
            args,
            result: typedResult,
            status: 'ok',
            error: null,
            startedAt: (meta as { startedAt?: number } | undefined)?.startedAt ?? null,
            durationMs: (meta as { durationMs?: number } | undefined)?.durationMs ?? null,
          });
        } catch {
          // ignore logging errors
        }
        try {
          const safeArgs = (() => {
            try {
              const a = args as Record<string, unknown>;
              if (a && typeof a === 'object') {
                const copy: Record<string, unknown> = { ...a };
                if (typeof copy['content'] === 'string') copy['content'] = `[${(copy['content'] as string).length} chars]`;
                return copy;
              }
              return args;
            } catch { return args; }
          })();
          console.log('[AI][tool:execute]', { sessionId, name, args: safeArgs, durationMs: (meta as any)?.durationMs });
        } catch { /* noop */ }
      },
    });

    // Filter tool set to only enabled tools
    const tools = Object.fromEntries(
      Object.entries(toolsAll).filter(([k]) => enabledTools.has(k))
    ) as ToolSet;
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AI][tools:active]', { active: Object.keys(tools) });
      }
    } catch { /* noop */ }

    // Backpressure guard: if session is currently rate-limited, return 429
    try {
      if (security.isRateLimited(sessionId)) {
        return res.status(429).json(toApiError('RATE_LIMITED', 'Too many tool calls in the last minute'));
      }
    } catch { /* noop */ }

    // Resolve model
    const { resolveModelForRequest } = await import('../agent/model-resolver');
    const provider: ProviderId = cfg.PROVIDER || 'openai';
    const preferredModelId = String(cfg.DEFAULT_MODEL || '');
    const modelIdIsReasoning = (() => {
      try {
        const s = preferredModelId.toLowerCase();
        return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
      } catch { return false; }
    })();
    // Keep selected model even for packed content to allow reasoning-first streams
    const effectiveModelId = preferredModelId;
    const { model } = await resolveModelForRequest({ db: deps.db as unknown as { getPreference: (k: string) => Promise<unknown> }, provider, modelId: effectiveModelId });

    // Dev-only: log tool param kinds
    try {
      if (process.env.NODE_ENV === 'development') {
        const snap: Record<string, string> = {};
        for (const [k, v] of Object.entries(tools as ToolSet)) {
          type ToolIntrospect = {
            inputSchema?: { jsonSchema?: { type?: string } };
            parameters?: { _def?: { typeName?: string } } | { type?: string };
          };
          const tv = v as ToolIntrospect;
          const schema = tv.inputSchema ?? tv.parameters;
          const tag: string = schema && typeof schema === 'object'
            ? ((schema as { jsonSchema?: { type?: string } }).jsonSchema?.type
              || (schema as { _def?: { typeName?: string } })._def?.typeName
              || (schema as { type?: string }).type
              || Object.prototype.toString.call(schema))
            : typeof schema;
          snap[k] = String(tag);
        }
        // eslint-disable-next-line no-console
        console.log('[AI] tool parameter kinds:', snap);
      }
    } catch { /* noop */ }

    // Always enable tools for normal operation; safety is enforced via security/config/approvals.
    // Tool disabling is now only done in specific error-retry paths below.
    try { console.log('[AI][chat:model]', { provider: cfg.PROVIDER || 'openai', modelId: cfg.DEFAULT_MODEL, toolsDisabled: false }); } catch { /* noop */ }

    // Temperature handling for reasoning models
    const modelIdStr = String(effectiveModelId || '');
    const isReasoningModel = (() => {
      try {
        const s = modelIdStr.toLowerCase();
        return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
      } catch { return false; }
    })();
    const cfgTemperature = cfg.TEMPERATURE;
    const shouldOmitTemperature = isReasoningModel && typeof cfgTemperature === 'number';
    if (shouldOmitTemperature) {
      try {
        res.setHeader('X-Pasteflow-Warning', 'temperature-ignored');
        res.setHeader('X-Pasteflow-Warning-Message', 'The temperature setting is not supported for this reasoning model and was ignored.');
        console.log('[AI][chat:model] reasoning model detected; temperature omitted');
      } catch { /* noop */ }
    }

    // Reasoning models on the Responses API require a following input item after the implicit reasoning item.
    // Ensure the last message is a user text message (or add a minimal one).
    let finalModelMessages: ModelMessage[] = modelMessages;
    if (isReasoningModel) {
      const needsUserTail = finalModelMessages.length === 0 || finalModelMessages[finalModelMessages.length - 1]?.role !== 'user';
      if (needsUserTail) {
        finalModelMessages = finalModelMessages.concat([{ role: 'user', content: [{ type: 'text', text: ' ' }] } as unknown as ModelMessage]);
      }
    }

    let start = Date.now();
    if (res.headersSent) return;
    const createStream = async (_attempt: number) => {
      start = Date.now();
      try { console.log('[AI][chat:stream:start]', { sessionId }); } catch { /* noop */ }
      return streamText({
        model,
        system,
        messages: finalModelMessages,
        tools,
        temperature: shouldOmitTemperature ? undefined : (typeof cfgTemperature === 'number' ? cfgTemperature : undefined),
        maxOutputTokens: cfg.MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
        onAbort: () => {},
        onFinish: async (info: unknown) => {
          try {
            const { input, output, total } = extractUsage(info);
            const latency = Date.now() - start;
            try { console.log('[AI][chat:stream:finish]', { sessionId, usage: { input, output, total }, latency }); } catch { /* noop */ }
            let cost: number | null = null;
            try {
              const { calculateCostUSD } = await import('../agent/pricing');
              const modelIdForPricing = String(cfg.DEFAULT_MODEL || '');
              const usage: { inputTokens?: number; outputTokens?: number } = {};
              if (input != null) usage.inputTokens = input;
              if (output != null) usage.outputTokens = output;
              cost = calculateCostUSD(provider, modelIdForPricing, usage);
            } catch { /* noop */ }
            try {
              if (process.env.NODE_ENV === 'development') {
                // eslint-disable-next-line no-console
                console.log('[AI][finish]', { input, output, total, latency, cost });
              }
            } catch { /* noop */ }
            await persistUsage(deps.db, sessionId, input, output, total, latency, cost);
          } catch { /* ignore persistence errors */ }
        },
      });
    };

    const result = await withRateLimitRetries(createStream, {
      attempts: cfg.RETRY_ATTEMPTS,
      baseMs: cfg.RETRY_BASE_MS,
      maxMs: cfg.RETRY_MAX_MS,
      isRetriable: isRetriableProviderError,
      getRetryAfterMs: getRetryAfterMsFromError,
    });

    if (res.headersSent) return;
    try { console.log('[AI][chat:stream:pipe]', { sessionId }); } catch { /* noop */ }
    result.pipeUIMessageStreamToResponse(res, { consumeSseStream: consumeStream });

    // Persist/refresh session shell with last known messages snapshot (cap messages)
    try {
      const maxMsgs = Number(process.env.PF_AGENT_MAX_SESSION_MESSAGES ?? 50);
      const msgJson = JSON.stringify(Array.isArray(uiMessages) ? uiMessages.slice(-Math.max(1, maxMsgs)) : uiMessages);
      const activeId = await deps.db.getPreference('workspace.active');
      const ws = activeId ? await deps.db.getWorkspace(String(activeId)) : null;
      await deps.db.upsertChatSession(sessionId, msgJson, ws ? String(ws.id) : null);
    } catch { /* ignore */ }

    // Usage persistence occurs in onFinish callback
  } catch (error) {
    let cause: unknown = error;
    try {
      const err = error as any;
      const status = Number(err?.status || err?.statusCode || err?.response?.status || err?.cause?.status || NaN);
      const name = String(err?.name || 'Error');
      const msg = String(err?.message || '');
      const code = String(err?.code || err?.data?.error?.code || err?.cause?.data?.error?.code || '');
      const param = String(err?.param || err?.data?.error?.param || err?.cause?.data?.error?.param || '');
      console.error('[AI][chat:error]', { name, status: Number.isFinite(status) ? status : undefined, code: code || undefined, param: param || undefined, message: clipLog(msg, 300) });
    } catch { /* noop */ }
    // Per-tool quarantine-on-error: if a specific tool's call is invalid, retry once without that tool
    if (isInvalidToolCallError(cause)) {
      try {
        const parsed = chatBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
        }

        // Determine which tool likely caused the error by message heuristics
        const enabledToolsSet = await getEnabledToolsSet(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
        const enabledNames = Array.from(enabledToolsSet);
        const badTool = extractToolNameFromError(cause, enabledNames);
        if (badTool && enabledToolsSet.has(badTool)) {
          try { console.warn('[AI][tool:quarantine]', { tool: badTool, reason: 'invalid-function-parameters' }); } catch { /* noop */ }

          // Quarantine just this tool for the retry
          const enabledMinus = new Set(enabledNames.filter((n) => n !== badTool));

          let modelMessages: ModelMessage[];
          try {
            modelMessages = convertToModelMessages(parsed.data.messages as Omit<UIMessage, 'id'>[]);
          } catch {
            return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid chat messages format'));
          }

          const _headers = (req.headers ?? {}) as Record<string, unknown>;
          const headerSession = String(((_headers['x-pasteflow-session'] as unknown) || (_headers['x-pf-session-id'] as unknown) || '')).trim();
          const sessionId = parsed.data.sessionId || (headerSession || randomUUID());

          const envelope = parsed.data.context;
          const allowed = getAllowedWorkspacePaths();
          const safeEnvelope = envelope ? sanitizeContextEnvelope(envelope, allowed) : undefined;
          const system = await composeEffectiveSystemPrompt(
            deps.db as unknown as { getPreference: (k: string) => Promise<unknown> },
            {
              initial: safeEnvelope?.initial,
              dynamic: safeEnvelope?.dynamic ?? { files: [] },
              workspace: safeEnvelope?.workspace ?? null,
            },
            { enabledTools: enabledMinus }
          );

          const controller = new AbortController();
          const onAbort = () => { try { controller.abort(); } catch { /* noop */ } };
          req.on('aborted', onAbort);
          res.on('close', onAbort);

          const { resolveAgentConfig } = await import('../agent/config');
          const cfg = await resolveAgentConfig(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });

          const { resolveModelForRequest } = await import('../agent/model-resolver');
          const provider: ProviderId = cfg.PROVIDER || 'openai';
          const preferredModelId = String(cfg.DEFAULT_MODEL || '');
          const modelIdIsReasoning = (() => {
            try {
              const s = preferredModelId.toLowerCase();
              return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
            } catch { return false; }
          })();
          // Keep selected model even for packed content to allow reasoning-first streams
          const effectiveModelId = preferredModelId;
          const { model } = await resolveModelForRequest({ db: deps.db as unknown as { getPreference: (k: string) => Promise<unknown> }, provider, modelId: effectiveModelId });

          const cfgTemperature = cfg.TEMPERATURE;
          const shouldOmitTemperature = modelIdIsReasoning && typeof cfgTemperature === 'number';
          let finalRetryMessages: ModelMessage[] = modelMessages;
          if (modelIdIsReasoning) {
            const needsUserTail = finalRetryMessages.length === 0 || finalRetryMessages[finalRetryMessages.length - 1]?.role !== 'user';
            if (needsUserTail) {
              finalRetryMessages = finalRetryMessages.concat([{ role: 'user', content: [{ type: 'text', text: ' ' }] } as unknown as ModelMessage]);
            }
          }

          // Build tool set minus the quarantined tool
          const { AgentSecurityManager } = await import('../agent/security-manager');
          const security = await AgentSecurityManager.create({ db: deps.db as unknown as { getPreference: (k: string) => Promise<unknown> } });
          const { getAgentTools } = await import('../agent/tools');
          const toolsAll = getAgentTools({
            signal: controller.signal,
            security,
            config: cfg,
            sessionId,
            onToolExecute: async (name, args, result, meta) => {
              try {
                const typedResult = name === 'context' ? (result as ContextResult) : result;
                await deps.db.insertToolExecution({
                  sessionId,
                  toolName: String(name),
                  args,
                  result: typedResult,
                  status: 'ok',
                  error: null,
                  startedAt: (meta as { startedAt?: number } | undefined)?.startedAt ?? null,
                  durationMs: (meta as { durationMs?: number } | undefined)?.durationMs ?? null,
                });
              } catch { /* ignore */ }
            },
          });
          const tools = Object.fromEntries(
            Object.entries(toolsAll).filter(([k]) => enabledMinus.has(k))
          ) as ToolSet;

          try {
            res.setHeader('X-Pasteflow-Warning', 'tool-quarantined');
            res.setHeader('X-Pasteflow-Tool-Quarantined', badTool);
            res.setHeader('X-Pasteflow-Warning-Message', `Tool "${badTool}" quarantined due to invalid tool call; retried without it.`);
          } catch { /* noop */ }

          let start = Date.now();
          if (res.headersSent) return; // safety
          const createStream = async (_attempt: number) => {
            start = Date.now();
            return streamText({
              model,
              system,
              messages: finalRetryMessages,
              tools,
              temperature: shouldOmitTemperature ? undefined : cfgTemperature,
              maxOutputTokens: cfg.MAX_OUTPUT_TOKENS,
              abortSignal: controller.signal,
              onAbort: () => {},
              onFinish: async (info: unknown) => {
                try {
                  const { input, output, total } = extractUsage(info);
                  const latency = Date.now() - start;
                  let cost: number | null = null;
                  try {
                    const { calculateCostUSD } = await import('../agent/pricing');
                    const modelIdForPricing = String(effectiveModelId || '');
                    cost = calculateCostUSD(provider, modelIdForPricing, { inputTokens: input ?? undefined, outputTokens: output ?? undefined });
                  } catch { /* noop */ }
                  await persistUsage(deps.db, sessionId, input, output, total, latency, cost);
                } catch { /* ignore persistence errors */ }
              },
            });
          };

          const result = await withRateLimitRetries(createStream, {
            attempts: cfg.RETRY_ATTEMPTS,
            baseMs: cfg.RETRY_BASE_MS,
            maxMs: cfg.RETRY_MAX_MS,
            isRetriable: isRetriableProviderError,
            getRetryAfterMs: getRetryAfterMsFromError,
          });

          if (res.headersSent) return;
          result.pipeUIMessageStreamToResponse(res, { consumeSseStream: consumeStream });

          try {
            const maxMsgs = Number(process.env.PF_AGENT_MAX_SESSION_MESSAGES ?? 50);
            const msgJson = JSON.stringify(Array.isArray(parsed.data.messages) ? parsed.data.messages.slice(-Math.max(1, maxMsgs)) : parsed.data.messages);
            const activeId = await deps.db.getPreference('workspace.active');
            const ws = activeId ? await deps.db.getWorkspace(String(activeId)) : null;
            await deps.db.upsertChatSession(sessionId, msgJson, ws ? String(ws.id) : null);
          } catch { /* ignore */ }

          return; // streamed response
        }
      } catch (fallbackError) {
        // Merge back into error handling below
        cause = fallbackError;
      }
    }

    // Provider config/auth issues
    if (isProviderConfigError(cause) || isAuthError(cause)) {
      try { console.warn('AI provider config error or auth failure'); } catch { /* noop */ }
      let providerName = 'openai';
      try {
        const { resolveAgentConfig } = await import('../agent/config');
        const cfg2 = await resolveAgentConfig(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
        providerName = cfg2.PROVIDER || 'openai';
      } catch { /* noop */ }
      return res
        .status(503)
        .json(
          toApiError('AI_PROVIDER_CONFIG', 'AI provider credentials missing or invalid', {
            provider: providerName,
            reason: isProviderConfigError(cause) ? 'credentials-missing' : 'unauthorized',
          })
        );
    }

    // Invalid/unknown model id
    if (isInvalidModelError(cause)) {
      const mod = await import('../agent/config');
      let resolved: string | undefined;
      try {
        const cfgRes = await mod.resolveAgentConfig(deps.db as unknown as { getPreference: (k: string) => Promise<unknown> });
        resolved = cfgRes.DEFAULT_MODEL;
      } catch { /* noop */ }
      return res.status(400).json(
        toApiError('AI_INVALID_MODEL', 'Selected model is not available', {
          model: resolved || undefined,
        })
      );
    }

    const status = getStatusFromAIError(cause);
    if (status && status >= 400 && status <= 599) {
      return res.status(status).json(toApiError(status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', (cause as Error)?.message || 'Request failed'));
    }

    const message = (cause as Error)?.message || 'Unknown error';
    return res.status(500).json(toApiError('SERVER_ERROR', message));
  }
}

// Helper: sanitize context envelope
export function sanitizeContextEnvelope(envelope: AgentContextEnvelope, allowed: readonly string[]) {
  try {
    if (!envelope || !Array.isArray(allowed) || allowed.length === 0) return envelope;
    const safeFiles = (files: AgentContextEnvelope['dynamic']['files']) => {
      const out: AgentContextEnvelope['dynamic']['files'] = [];
      for (const f of Array.isArray(files) ? files : []) {
        const p = String(f?.path || '');
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
          // no relative path within allowed roots
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

    const dynamic = { files: safeFiles(envelope.dynamic?.files || []) } as AgentContextEnvelope['dynamic'];
    const workspace = typeof envelope.workspace === 'string' ? envelope.workspace : null;

    return { version: 1 as const, initial, dynamic, workspace };
  } catch {
    return envelope;
  }
}

// Usage helpers
export function extractUsage(info: unknown): { input: number | null; output: number | null; total: number | null } {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  const get = (o: unknown, k: string): unknown => (isObject(o) ? (o as Record<string, unknown>)[k] : undefined);
  const usage = get(info, 'usage');
  const input = get(usage, 'inputTokens');
  const output = get(usage, 'outputTokens');
  const total = get(usage, 'totalTokens');
  const toNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const i = toNum(input);
  const o = toNum(output);
  const t = toNum(total);
  let totalOut: number | null = null;
  if (typeof t === 'number') totalOut = t;
  else if (typeof i === 'number' && typeof o === 'number') totalOut = i + o;
  return { input: i, output: o, total: totalOut };
}

export async function persistUsage(
  db: DatabaseBridge,
  sessionId: string,
  input: number | null,
  output: number | null,
  total: number | null,
  latency: number | null,
  cost: number | null,
): Promise<void> {
  const dbObj = db as unknown as {
    insertUsageSummaryWithLatencyAndCost?: (sessionId: string, input: number | null, output: number | null, total: number | null, latencyMs: number | null, costUsd: number | null) => Promise<unknown>;
    insertUsageSummaryWithLatency?: (sessionId: string, input: number | null, output: number | null, total: number | null, latencyMs: number | null) => Promise<unknown>;
    insertUsageSummary: (sessionId: string, input: number | null, output: number | null, total: number | null) => Promise<unknown>;
  };
  if (typeof dbObj.insertUsageSummaryWithLatencyAndCost === 'function') {
    await dbObj.insertUsageSummaryWithLatencyAndCost(sessionId, input, output, total, latency, cost);
    return;
  }
  if (typeof dbObj.insertUsageSummaryWithLatency === 'function') {
    await dbObj.insertUsageSummaryWithLatency(sessionId, input, output, total, latency);
    return;
  }
  await dbObj.insertUsageSummary(sessionId, input, output, total);
}

// Error classification helpers
export function isProviderConfigError(err: unknown): boolean {
  try {
    const name = String((err as { name?: string } | null | undefined)?.name || '');
    const msg = String((err as { message?: string } | null | undefined)?.message || '').toLowerCase();
    return name === 'AI_LoadAPIKeyError' || name.includes('LoadAPIKeyError') || msg.includes('api key is missing');
  } catch {
    return false;
  }
}

export function isAuthError(err: unknown): boolean {
  try {
    const status = Number(
      (err as { status?: number } | null | undefined)?.status
      ?? (err as { statusCode?: number } | null | undefined)?.statusCode
      ?? (err as { response?: { status?: number } } | null | undefined)?.response?.status
      ?? (err as { cause?: { status?: number } } | null | undefined)?.cause?.status
    );
    if (status === 401 || status === 403) return true;
    const msg = String((err as { message?: string } | null | undefined)?.message || '').toLowerCase();
    return msg.includes('unauthorized') || msg.includes('invalid api key');
  } catch { return false; }
}

export function isInvalidModelError(err: unknown): boolean {
  try {
    const status = Number(
      (err as { status?: number } | null | undefined)?.status
      ?? (err as { statusCode?: number } | null | undefined)?.statusCode
      ?? (err as { response?: { status?: number } } | null | undefined)?.response?.status
      ?? (err as { cause?: { status?: number } } | null | undefined)?.cause?.status
    );
    const msg = String((err as { message?: string } | null | undefined)?.message || '').toLowerCase();
    return status === 404
      || msg.includes('model_not_found')
      || (msg.includes('model') && msg.includes('does not exist'))
      || msg.includes('unknown model')
      || msg.includes('invalid model');
  } catch { return false; }
}

export function getStatusFromAIError(err: unknown): number | null {
  try {
    const status = Number(
      (err as { status?: number } | null | undefined)?.status
      ?? (err as { statusCode?: number } | null | undefined)?.statusCode
      ?? (err as { response?: { status?: number } } | null | undefined)?.response?.status
      ?? (err as { cause?: { status?: number } } | null | undefined)?.cause?.status
    );
    if (Number.isFinite(status)) return status;
    const msg = String((err as { message?: string } | null | undefined)?.message || '').toLowerCase();
    if (/(?:^|\b)(429|too many requests)(?:\b|$)/.test(msg)) return 429;
    return null;
  } catch { return null; }
}

export function isRetriableProviderError(err: unknown): boolean {
  try {
    const status = getStatusFromAIError(err);
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  } catch { return false; }
}

export function getRetryAfterMsFromError(err: unknown): number | null {
  try {
    const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    const get = (o: unknown, k: string): unknown => (isObject(o) ? (o as Record<string, unknown>)[k] : undefined);
    const headerGet = (headersObj: unknown, name: string): string | undefined => {
      if (!isObject(headersObj)) return undefined;
      try {
        const maybeGet = (headersObj as { get?: (n: string) => string | null | undefined }).get;
        if (typeof maybeGet === 'function') {
          const v = maybeGet.call(headersObj, name) || maybeGet.call(headersObj, name.toLowerCase()) || maybeGet.call(headersObj, name.toUpperCase());
          return typeof v === 'string' ? v : undefined;
        }
        const rec = headersObj as Record<string, unknown>;
        const raw = rec[name] ?? rec[name.toLowerCase?.() ?? name] ?? rec[name.toUpperCase?.() ?? name];
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'number') return String(raw);
        return undefined;
      } catch { return undefined; }
    };

    const parseRetryAfterMs = (value: string): number | null => {
      if (!value) return null;
      const trimmed = String(value).trim();
      const asNum = Number(trimmed);
      if (Number.isFinite(asNum) && asNum >= 0) return Math.floor(asNum * 1000);
      const dateMs = Date.parse(trimmed);
      if (Number.isFinite(dateMs)) {
        const diff = dateMs - Date.now();
        return diff > 0 ? diff : 0;
      }
      return null;
    };

    const candidates = [
      get(get(err, 'response'), 'headers'),
      get(err, 'headers'),
      get(get(get(err, 'cause'), 'response'), 'headers'),
      get(get(err, 'cause'), 'headers'),
    ];
    for (const h of candidates) {
      const v = headerGet(h, 'retry-after');
      if (typeof v === 'string' && v) {
        const ms = parseRetryAfterMs(v);
        if (ms != null) return ms;
      }
    }
    return null;
  } catch { return null; }
}

export function isInvalidToolCallError(err: unknown): boolean {
  try {
    const toStr = (v: unknown) => (v == null ? '' : String(v));
    const msg = toStr((err as { message?: string } | null | undefined)?.message).toLowerCase();
    const code = toStr(
      (err as { code?: string } | null | undefined)?.code
      ?? (err as { data?: { error?: { code?: string } } } | null | undefined)?.data?.error?.code
      ?? (err as { cause?: { data?: { error?: { code?: string } } } } | null | undefined)?.cause?.data?.error?.code
    ).toLowerCase();
    return code.includes('invalid_function_parameters')
      || msg.includes('invalid_function_parameters')
      || msg.includes('invalid schema for function')
      || msg.includes('parameters must be json schema type');
  } catch { return false; }
}

export function extractToolNameFromError(err: unknown, candidates: string[]): string | null {
  try {
    const seen = new Set<string>();
    const texts: string[] = [];
    const push = (v: unknown) => { try { const s = String(v || ''); if (s && !seen.has(s)) { seen.add(s); texts.push(s.toLowerCase()); } } catch {} };
    push((err as { message?: string } | null | undefined)?.message);
    push((err as { param?: string } | null | undefined)?.param);
    const d = (err as { data?: { error?: { message?: string; param?: string } } } | null | undefined)?.data?.error;
    if (d) { push(d.message); push(d.param); }
    const c = (err as { cause?: { message?: string; data?: { error?: { message?: string; param?: string } } } } | null | undefined)?.cause;
    if (c) { push(c.message); const ce = c?.data?.error; if (ce) { push(ce.message); push(ce.param); } }

    // Common patterns: function '<name>', function "<name>", tool '<name>'
    for (const cand of candidates) {
      const lc = cand.toLowerCase();
      const patterns = [
        `function '${lc}'`,
        `function "${lc}"`,
        `function ${lc}`,
        `tool '${lc}'`,
        `tool "${lc}"`,
        `tool ${lc}`,
        `'${lc}'`,
        `"${lc}"`,
        ` ${lc} `,
      ];
      for (const t of texts) {
        for (const p of patterns) {
          if (t.includes(p)) return cand;
        }
      }
    }
    return null;
  } catch { return null; }
}
