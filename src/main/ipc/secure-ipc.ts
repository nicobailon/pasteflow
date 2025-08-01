import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { z, ZodSchema } from 'zod';
import { RateLimiter } from 'limiter';

// IPC channel configuration
interface IpcChannelConfig<TInput, TOutput> {
  input: ZodSchema<TInput>;
  output: ZodSchema<TOutput>;
  rateLimit: number;
  handler?: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>;
}

export class SecureIpcLayer {
  private channels = new Map<string, IpcChannelConfig<unknown, unknown>>();
  private rateLimiters = new Map<string, RateLimiter>();

  constructor() {
    this.setupChannels();
  }

  private setupChannels() {
    // Import schemas
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
      ActivePromptsSchema
    } = require('./schemas');

    // Define all IPC channels with their schemas
    this.registerChannel('/workspace/list', {
      input: z.object({}),
      output: z.array(WorkspaceSchema),
      rateLimit: 10
    });

    this.registerChannel('/workspace/create', {
      input: WorkspaceCreateSchema,
      output: WorkspaceSchema,
      rateLimit: 5
    });

    this.registerChannel('/workspace/load', {
      input: z.object({ id: z.string().uuid() }),
      output: WorkspaceSchema,
      rateLimit: 20
    });

    this.registerChannel('/workspace/update', {
      input: WorkspaceUpdateSchema,
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/workspace/delete', {
      input: z.object({ id: z.string().uuid() }),
      output: z.boolean(),
      rateLimit: 5
    });

    this.registerChannel('/file/content', {
      input: FileContentRequestSchema,
      output: FileContentResponseSchema,
      rateLimit: 100
    });

    this.registerChannel('/file/save', {
      input: FileSaveSchema,
      output: z.boolean(),
      rateLimit: 50
    });

    this.registerChannel('/prefs/get', {
      input: PreferenceGetSchema,
      output: z.unknown(),
      rateLimit: 50
    });

    this.registerChannel('/prefs/set', {
      input: PreferenceSetSchema,
      output: z.boolean(),
      rateLimit: 20
    });

    this.registerChannel('/prompt/list', {
      input: z.object({ type: z.enum(['system', 'role']).optional() }),
      output: z.array(PromptSchema),
      rateLimit: 20
    });

    this.registerChannel('/prompt/create', {
      input: PromptSchema.omit({ id: true, createdAt: true, updatedAt: true }),
      output: PromptSchema,
      rateLimit: 10
    });

    this.registerChannel('/prompt/update', {
      input: PromptSchema,
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompt/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: 10
    });

    // State management channels
    this.registerChannel('/workspace/current', {
      input: z.object({}),
      output: z.union([WorkspaceSchema, z.null()]),
      rateLimit: 50
    });

    this.registerChannel('/workspace/set-current', {
      input: z.object({ workspace: z.record(z.unknown()) }),
      output: z.boolean(),
      rateLimit: 20
    });

    this.registerChannel('/workspace/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: 20
    });

    this.registerChannel('/workspace/touch', {
      input: z.object({ id: z.string().uuid() }),
      output: z.boolean(),
      rateLimit: 20
    });

    this.registerChannel('/workspace/rename', {
      input: z.object({ id: z.string().uuid(), newName: z.string().min(1).max(255) }),
      output: z.boolean(),
      rateLimit: 10
    });

    // Selection state channels
    this.registerChannel('/workspace/selection', {
      input: z.object({}),
      output: WorkspaceSelectionSchema,
      rateLimit: 50
    });

    this.registerChannel('/workspace/selection/update', {
      input: WorkspaceSelectionUpdateSchema,
      output: z.boolean(),
      rateLimit: 30
    });

    this.registerChannel('/workspace/selection/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: 20
    });

    // Prompt state channels
    this.registerChannel('/prompts/system', {
      input: z.object({}),
      output: z.array(PromptSchema),
      rateLimit: 20
    });

    this.registerChannel('/prompts/role', {
      input: z.object({}),
      output: z.array(PromptSchema),
      rateLimit: 20
    });

    this.registerChannel('/prompts/system/add', {
      input: PromptSchema.omit({ createdAt: true, updatedAt: true }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/system/update', {
      input: z.object({ id: z.string(), updates: z.record(z.unknown()) }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/system/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/role/add', {
      input: PromptSchema.omit({ createdAt: true, updatedAt: true }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/role/update', {
      input: z.object({ id: z.string(), updates: z.record(z.unknown()) }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/role/delete', {
      input: z.object({ id: z.string() }),
      output: z.boolean(),
      rateLimit: 10
    });

    this.registerChannel('/prompts/active', {
      input: z.object({}),
      output: ActivePromptsSchema,
      rateLimit: 50
    });

    this.registerChannel('/prompts/active/update', {
      input: ActivePromptsSchema,
      output: z.boolean(),
      rateLimit: 20
    });

    this.registerChannel('/prompts/active/clear', {
      input: z.object({}),
      output: z.boolean(),
      rateLimit: 20
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
    ipcMain.handle(channel, async (event, rawInput) => {
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
          throw new Error(`Validation error: ${error.message}`);
        }
        
        throw error;
      }
    });
  }

  private async performSecurityChecks(
    channel: string,
    event: IpcMainInvokeEvent
  ) {
    // Verify origin
    const url = event.senderFrame.url;
    if (!url.startsWith('file://')) {
      throw new Error('Invalid origin');
    }

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
    handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>
  ) {
    const config = this.channels.get(channel);
    if (!config) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    
    config.handler = handler as (input: unknown, event: IpcMainInvokeEvent) => Promise<unknown>;
  }

  // Get registered channels (for testing/documentation)
  getChannels(): string[] {
    return Array.from(this.channels.keys());
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