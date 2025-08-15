import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, BrowserWindow } from 'electron';

import { SecureIpcLayer } from '../ipc/secure-ipc';
import { StateHandlers } from '../handlers/state-handlers';
import { countTokens } from '../utils/token-utils';

import { SecureDatabase } from './secure-database';

interface FileSaveInput {
  workspaceId: string;
  filePath: string;
  content: string;
  tokenCount: number;
}

interface PromptListInput {
  type?: 'system' | 'role';
}

interface PromptCreateInput {
  type: 'system' | 'role';
  name: string;
  content: string;
  tokenCount?: number;
  isActive?: boolean;
}

interface PromptUpdateInput {
  id: string;
  name: string;
  content: string;
  tokenCount?: number;
  isActive?: boolean;
  type?: 'system' | 'role';
}

interface PromptDeleteInput {
  id: string;
}

export class DatabaseManager {
  private db!: SecureDatabase;
  private ipc!: SecureIpcLayer;
  private static instance: DatabaseManager;

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize() {
    // Initialize database
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pasteflow.db');
    
    console.log('Initializing PasteFlow database at:', dbPath);
    this.db = await SecureDatabase.create(dbPath);
    
    // Initialize IPC layer
    this.ipc = new SecureIpcLayer();
    
    // Initialize state handlers (they register their own IPC handlers)
    new StateHandlers(this.db, this.ipc);
    
    // Wire up legacy IPC handlers to database operations
    this.setupHandlers();
    
    console.log('Database and IPC layer initialized successfully');
  }

  private setupHandlers() {
    // Workspace & file-content & prefs are handled by StateHandlers.

    this.ipc.setHandler('/file/save', async (input: unknown) => {
      const validatedInput = input as FileSaveInput; // already Zod-validated by SecureIpcLayer
      // Ensure tokenCount exists even if omitted by caller
      const tokenCount =
        validatedInput.tokenCount ?? countTokens(validatedInput.content);
      await this.db.saveFileContent(
        validatedInput.workspaceId,
        validatedInput.filePath,
        validatedInput.content,
        tokenCount
      );
      return true;
    });

    // Preferences are handled by StateHandlers (with encryption/JSON handling).

    // Prompt handlers
    this.ipc.setHandler('/prompt/list', async (input: unknown) => {
      const validatedInput = input as PromptListInput; // Zod validated
      const rows = validatedInput.type
        ? await this.db.database.all<{
            id: string; type: string; name: string; content: string;
            token_count: number | null; is_active: number; created_at: number; updated_at: number;
          }>('SELECT * FROM prompts WHERE is_active = 1 AND type = ?', [validatedInput.type])
        : await this.db.database.all<{
            id: string;
            type: string;
            name: string;
            content: string;
            token_count: number | null;
            is_active: number;
            created_at: number;
            updated_at: number;
          }>('SELECT * FROM prompts WHERE is_active = 1');

      return rows
        .map(p => ({
          id: p.id,
          type: p.type as 'system' | 'role',
          name: p.name,
          content: p.content,
          tokenCount: p.token_count || undefined,
          isActive: p.is_active === 1,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        }));
    });

    this.ipc.setHandler('/prompt/create', async (input: unknown) => {
      const validatedInput = input as PromptCreateInput;
      const id = randomUUID();
      const tokenCount = validatedInput.tokenCount || countTokens(validatedInput.content);
      
      await this.db.database.run(
        `INSERT INTO prompts (id, type, name, content, token_count, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, validatedInput.type, validatedInput.name, validatedInput.content, tokenCount, validatedInput.isActive ? 1 : 0]
      );
      
      const created = await this.db.database.get<{
        id: string;
        type: string;
        name: string;
        content: string;
        token_count: number;
        is_active: number;
        created_at: number;
        updated_at: number;
      }>('SELECT * FROM prompts WHERE id = ?', [id]);
      
      if (!created) {
        throw new Error('Failed to create prompt');
      }

      // Broadcast update to notify all renderer processes
      const updateChannel = created.type === 'system' ? '/prompts/system:update' : '/prompts/role:update';
      this.broadcastUpdate(updateChannel);

      return {
        id: created.id,
        type: created.type as 'system' | 'role',
        name: created.name,
        content: created.content,
        tokenCount: created.token_count,
        isActive: created.is_active === 1,
        createdAt: created.created_at,
        updatedAt: created.updated_at
      };
    });

    this.ipc.setHandler('/prompt/update', async (input: unknown) => {
      const validatedInput = input as PromptUpdateInput & { type?: 'system' | 'role' };
      // If tokenCount wasn't provided but content changed, recompute it
      const effectiveTokenCount =
        validatedInput.tokenCount ?? countTokens(validatedInput.content);

      await this.db.database.run(
        `UPDATE prompts
         SET name = ?, content = ?, token_count = ?, is_active = ?
         WHERE id = ?`,
        [validatedInput.name, validatedInput.content, effectiveTokenCount, validatedInput.isActive ? 1 : 0, validatedInput.id]
      );

      // Broadcast update to notify all renderer processes
      let promptType = validatedInput.type;
      if (!promptType) {
        const row = await this.db.database.get<{ type: string }>(
          'SELECT type FROM prompts WHERE id = ?',
          [validatedInput.id]
        );
        promptType = (row?.type as 'system' | 'role') ?? 'role';
      }
      const updateChannel = promptType === 'system' ? '/prompts/system:update' : '/prompts/role:update';
      this.broadcastUpdate(updateChannel);

      return true;
    });

    this.ipc.setHandler('/prompt/delete', async (input: unknown) => {
      const validatedInput = input as PromptDeleteInput;

      // Get the prompt type before deleting for broadcast
      const prompt = await this.db.database.get<{ type: string }>('SELECT type FROM prompts WHERE id = ?', [validatedInput.id]);

      await this.db.database.run('DELETE FROM prompts WHERE id = ?', [validatedInput.id]);

      // Broadcast update to notify all renderer processes
      if (prompt) {
        const updateChannel = prompt.type === 'system' ? '/prompts/system:update' : '/prompts/role:update';
        this.broadcastUpdate(updateChannel);
      }

      return true;
    });

    // Migration handlers (currently disabled - migration modules not present)
    // These handlers are kept for future implementation when migration is needed
  }

  async close() {
    this.ipc.unregisterAll();
    await this.db.close();
  }

  // Getter for database (for direct access if needed)
  get database(): SecureDatabase {
    return this.db;
  }

  // Helper method to broadcast updates to all renderer processes
  private broadcastUpdate(channel: string, data?: unknown) {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send(channel, data);
    }
  }
}