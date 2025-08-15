import { ipcMain } from 'electron';
import type Electron from 'electron';
import { z, ZodSchema } from 'zod';
import { RateLimiter } from 'limiter';

import { RATE_LIMITS } from '../../constants/app-constants';

// IPC channel configuration
interface IpcChannelConfig<TInput, TOutput> {
  input: ZodSchema<TInput>;
  output: ZodSchema<TOutput>;
  rateLimit: number;
  handler?: (input: TInput, event: Electron.IpcMainInvokeEvent) => Promise<TOutput>;
}

// Channel category mapping for dynamic rate limiting
type ChannelCategory = 'workspace' | 'file' | 'prompt' | 'prompts' | 'state' | 'prefs' | 'general';

export class SecureIpcLayer {
  private channels = new Map<string, IpcChannelConfig<unknown, unknown>>();
  private rateLimiters = new Map<string, RateLimiter>();

  constructor() {
    this.setupChannels();
  }

  /**
   * Determine rate limit based on channel category and operation type
   */
  private getRateLimit(channel: string): number {
    // Parse channel path to determine category
    const parts = channel.split('/').filter(Boolean);
    const category = parts[0] as ChannelCategory;
    const operation = parts[1];
    
    // Map categories to rate limit constants
    switch (category) {
      case 'workspace': {
        // Workspace operations have different limits based on operation type
        if (operation === 'list' || operation === 'current' || operation === 'selection') {
          return RATE_LIMITS.REQUESTS.WORKSPACE_OPERATIONS;
        }
        if (operation === 'exists' || operation === 'touch') {
          return RATE_LIMITS.REQUESTS.WORKSPACE_OPERATIONS * 2; // Higher for frequent checks
        }
        return RATE_LIMITS.REQUESTS.STATE_OPERATIONS;
      }
        
      case 'file': {
        // File operations have high limits due to frequent access
        return operation === 'content' ? 
          RATE_LIMITS.REQUESTS.FILE_CONTENT : 
          RATE_LIMITS.REQUESTS.FILE_LIST;
      }
        
      case 'prompt':
      case 'prompts': {
        // Prompt operations
        return operation === 'list' || operation === 'active' ? 
          RATE_LIMITS.REQUESTS.PROMPT_OPERATIONS :
          RATE_LIMITS.REQUESTS.STATE_OPERATIONS;
      }
        
      case 'prefs': {
        // Preferences - read operations have higher limits
        return operation === 'get' ? 
          RATE_LIMITS.REQUESTS.FILE_LIST : // Use higher limit for frequent reads
          RATE_LIMITS.REQUESTS.STATE_OPERATIONS;
      }
        
      case 'state': {
        // State operations
        return RATE_LIMITS.REQUESTS.STATE_OPERATIONS;
      }
        
      default: {
        // Default to general limit
        return RATE_LIMITS.REQUESTS.GENERAL;
      }
    }
  }

  private setupChannels() {
    // Import schemas from generated CJS file
    // eslint-disable-next-line @typescript-eslint/no-var-requires, unicorn/prefer-module
    const schemas = require('../../../lib/main/ipc/schemas.cjs');
    const {
      WorkspaceSchema,
      WorkspaceCreateSchema,
      WorkspaceUpdateSchema,
      FileContentRequestSchema,
      FileContentResponseSchema,
      FileSaveSchema,
      PreferenceGetSchema,
      PreferenceSetSchema,
      PromptSchema,
      WorkspaceSelectionSchema,
      WorkspaceSelectionUpdateSchema,
      ActivePromptsSchema,
      InstructionSchema,
      InstructionCreateSchema
    } = schemas;

    // Define all IPC channels with their schemas
    this.registerChannel('/workspace/list', {
      input: z.object({}),
      output: z.array(WorkspaceSchema),
      rateLimit: this.getRateLimit('/workspace/list')
    });

    this.registerChannel('/workspace/create', {
      input: WorkspaceCreateSchema,
      output: WorkspaceSchema,
      rateLimit: this.getRateLimit('/workspace/create')
    });

    this.registerChannel('/workspace/load', {
      // Accept either a UUID or a workspace name as identifier
      input: z.object({ id: z.string().min(1) }),
      output: z.union([WorkspaceSchema, z.null()]),
      rateLimit: this.getRateLimit('/workspace/load')
    });

    this.registerChannel('/workspace/exists', {
      // Check if a workspace exists by name
      input: z.object({ name: z.string().min(1) }),
      output: z.object({ exists: z.boolean(), id: z.string().optional() }),
      rateLimit: this.getRateLimit('/workspace/exists')
    });

    this.registerChannel('/workspace/update', {
      input: WorkspaceUpdateSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/update')
    });

    this.registerChannel('/workspace/delete', {
      input: z.object({ id: z.string().uuid() }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/delete')
    });

    this.registerChannel('/file/content', {
      input: FileContentRequestSchema,
      output: FileContentResponseSchema,
      rateLimit: this.getRateLimit('/file/content')
    });

    this.registerChannel('/file/save', {
      input: FileSaveSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/file/save')
    });

    this.registerChannel('/prefs/get', {
      input: PreferenceGetSchema,
      output: z.unknown(),
      rateLimit: this.getRateLimit('/prefs/get')
    });

    this.registerChannel('/prefs/set', {
      input: PreferenceSetSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prefs/set')
    });

    this.registerChannel('/prompt/list', {
      input: z.object({ type: z.enum(['system', 'role']).optional() }),
      output: z.array(PromptSchema),
      rateLimit: this.getRateLimit('/prompt/list')
    });

    this.registerChannel('/prompt/create', {
      input: PromptSchema.omit({ id: true, createdAt: true, updatedAt: true }),
      output: PromptSchema,
      rateLimit: this.getRateLimit('/prompt/create')
    });

    this.registerChannel('/prompt/update', {
      input: PromptSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompt/update')
    });

    this.registerChannel('/prompt/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompt/delete')
    });

    // State management channels
    this.registerChannel('/workspace/current', {
      input: z.object({}),
      output: z.union([WorkspaceSchema, z.null()]),
      rateLimit: this.getRateLimit('/workspace/current')
    });

    this.registerChannel('/workspace/set-current', {
      input: z.object({ workspace: z.record(z.string(), z.unknown()) }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/set-current')
    });

    this.registerChannel('/workspace/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/clear')
    });

    this.registerChannel('/workspace/touch', {
      // Accept either uuid or workspace name for backward compatibility
      input: z.object({ id: z.string().min(1) }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/touch')
    });

    this.registerChannel('/workspace/rename', {
      input: z.object({ id: z.string().uuid(), newName: z.string().min(1).max(255) }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/rename')
    });

    // Selection state channels
    this.registerChannel('/workspace/selection', {
      input: z.object({}),
      output: WorkspaceSelectionSchema,
      rateLimit: this.getRateLimit('/workspace/selection')
    });

    this.registerChannel('/workspace/selection/update', {
      input: WorkspaceSelectionUpdateSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/selection/update')
    });

    this.registerChannel('/workspace/selection/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/workspace/selection/clear')
    });

    // Prompt state channels
    this.registerChannel('/prompts/system', {
      input: z.object({}),
      output: z.array(PromptSchema),
      rateLimit: this.getRateLimit('/prompts/system')
    });

    this.registerChannel('/prompts/role', {
      input: z.object({}),
      output: z.array(PromptSchema),
      rateLimit: this.getRateLimit('/prompts/role')
    });

    this.registerChannel('/prompts/system/add', {
      input: PromptSchema.omit({ createdAt: true, updatedAt: true }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/system/add')
    });

    this.registerChannel('/prompts/system/update', {
      input: z.object({ id: z.string(), updates: z.record(z.string(), z.unknown()) }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/system/update')
    });

    this.registerChannel('/prompts/system/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/system/delete')
    });

    this.registerChannel('/prompts/role/add', {
      input: PromptSchema.omit({ createdAt: true, updatedAt: true }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/role/add')
    });

    this.registerChannel('/prompts/role/update', {
      input: z.object({ id: z.string(), updates: z.record(z.string(), z.unknown()) }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/role/update')
    });

    this.registerChannel('/prompts/role/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/role/delete')
    });

    this.registerChannel('/prompts/active', {
      input: z.object({}),
      output: ActivePromptsSchema,
      rateLimit: this.getRateLimit('/prompts/active')
    });

    this.registerChannel('/prompts/active/update', {
      input: ActivePromptsSchema,
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/active/update')
    });

    this.registerChannel('/prompts/active/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: this.getRateLimit('/prompts/active/clear')
    });

    // Instructions channels
    this.registerChannel('/instructions/list', {
      input: z.object({}),
      output: z.array(InstructionSchema),
      rateLimit: this.getRateLimit('/instructions/list')
    });

    this.registerChannel('/instructions/create', {
      input: InstructionCreateSchema.extend({ id: z.string() }),
      output: z.object({ success: z.boolean() }),
      rateLimit: this.getRateLimit('/instructions/create')
    });

    this.registerChannel('/instructions/update', {
      input: InstructionSchema.pick({ id: true, name: true, content: true }),
      output: z.object({ success: z.boolean() }),
      rateLimit: this.getRateLimit('/instructions/update')
    });

    this.registerChannel('/instructions/delete', {
      input: z.object({ id: z.string() }),
      output: z.object({ success: z.boolean() }),
      rateLimit: this.getRateLimit('/instructions/delete')
    });
  }

  registerChannel<TInput, TOutput>(
    channel: string,
    config: IpcChannelConfig<TInput, TOutput>
  ) {
    this.channels.set(channel, config as IpcChannelConfig<unknown, unknown>);
    
    // Create rate limiter
    this.rateLimiters.set(channel, new RateLimiter({
      tokensPerInterval: config.rateLimit,
      interval: 'second',
      fireImmediately: true
    }));

    // Register IPC handler
    ipcMain.handle(channel, async (event: Electron.IpcMainInvokeEvent, rawInput: unknown) => {
      try {
        // Security checks
        await this.performSecurityChecks(channel, event);
        
        // Rate limiting
        await this.checkRateLimit(channel);
        
        // Input validation
        const validatedInput = config.input.parse(rawInput);
        
        // Execute handler
        let result: TOutput;
        if (config.handler) {
          result = await config.handler(validatedInput, event);
        } else {
          // Default handler (to be overridden)
          throw new Error(`No handler registered for ${channel}`);
        }
        
        // Output validation
        return config.output.parse(result);
        
      } catch (error) {
        console.error(`IPC error on ${channel}:`, error);
        
        if (error instanceof z.ZodError) {
          throw new TypeError(`Validation error: ${error.message}`);
        }
        
        throw error;
      }
    });
  }

  private async performSecurityChecks(
    _channel: string,
    event: Electron.IpcMainInvokeEvent
  ) {
    // Verify origin: allow file:// always; in dev allow localhost dev server
    if (!event.senderFrame) {
      throw new Error('Security check failed: No sender frame');
    }
    const url = event.senderFrame.url;

    // Production/package: only allow file:// pages
    if (url.startsWith('file://')) {
      return;
    }

    // Development: permit Electron dev server origins (localhost/127.0.0.1)
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      try {
        const current = new URL(url);
        const allowedOrigins = new Set<string>();

        // Allow the origin from ELECTRON_START_URL if provided (e.g., http://localhost:5173)
        const startUrl = process.env.ELECTRON_START_URL;
        if (startUrl) {
          try {
            const su = new URL(startUrl);
            allowedOrigins.add(`${su.protocol}//${su.host}`);
          } catch {
            // Invalid URL format in ELECTRON_START_URL - safe to ignore
          }
        }

        // Common local dev origins
        allowedOrigins.add('http://localhost:5173');
        allowedOrigins.add('http://127.0.0.1:5173');

        const origin = `${current.protocol}//${current.host}`;
        if (
          allowedOrigins.has(origin) ||
          ((current.hostname === 'localhost' || current.hostname === '127.0.0.1') && (current.protocol === 'http:' || current.protocol === 'https:'))
        ) {
          return;
        }
      } catch {
        // Fall through to error
      }
    }

    throw new Error('Invalid origin');

    // Additional checks can be added here
    // - CSRF tokens
    // - Session validation
    // - Permission checks
  }

  private async checkRateLimit(channel: string) {
    const limiter = this.rateLimiters.get(channel);
    if (!limiter) {
      throw new Error(`No rate limiter for channel: ${channel}`);
    }

    const hasToken = await limiter.tryRemoveTokens(1);
    if (!hasToken) {
      throw new Error('Rate limit exceeded');
    }
  }

  // Set handler for a channel
  setHandler<TInput, TOutput>(
    channel: string,
    handler: (input: TInput, event: Electron.IpcMainInvokeEvent) => Promise<TOutput>
  ) {
    const config = this.channels.get(channel);
    if (!config) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    
    config.handler = handler as (input: unknown, event: Electron.IpcMainInvokeEvent) => Promise<unknown>;
  }

  // Get registered channels (for testing/documentation)
  getChannels(): string[] {
    return [...this.channels.keys()];
  }

  // Unregister all handlers (for cleanup)
  unregisterAll() {
    for (const channel of this.channels.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.channels.clear();
    this.rateLimiters.clear();
  }
}