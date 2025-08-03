import { SecureDatabase } from './secure-database';
import { SecureIpcLayer } from '../ipc/secure-ipc';
import { StateHandlers } from '../handlers/state-handlers';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';

// Type definitions for IPC handler inputs
interface WorkspaceCreateInput {
  name: string;
  folderPath: string;
  state?: Record<string, unknown>;
}

interface WorkspaceLoadInput {
  id: string;
}

interface WorkspaceUpdateInput {
  id: string;
  state: Record<string, unknown>;
}

interface WorkspaceDeleteInput {
  id: string;
}

interface FileContentInput {
  workspaceId: string;
  filePath: string;
  lineRanges?: Array<{ start: number; end: number }>;
}

interface FileSaveInput {
  workspaceId: string;
  filePath: string;
  content: string;
  tokenCount: number;
}

interface PreferenceGetInput {
  key: string;
}

interface PreferenceSetInput {
  key: string;
  value: unknown;
  encrypted?: boolean;
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
    // Workspace handlers
    this.ipc.setHandler('/workspace/list', async () => {
      return this.db.listWorkspaces();
    });

    this.ipc.setHandler('/workspace/create', async (input: unknown) => {
      const validatedInput = input as WorkspaceCreateInput;
      const id = await this.db.createWorkspace(
        validatedInput.name,
        validatedInput.folderPath,
        validatedInput.state || {}
      );
      
      const workspace = await this.db.getWorkspace(id);
      if (!workspace) {
        throw new Error('Failed to create workspace');
      }
      
      return workspace;
    });

    this.ipc.setHandler('/workspace/load', async (input: unknown) => {
      const validatedInput = input as WorkspaceLoadInput;
      const workspace = await this.db.getWorkspace(validatedInput.id);
      if (!workspace) {
        throw new Error('Workspace not found');
      }
      return workspace;
    });

    this.ipc.setHandler('/workspace/update', async (input: unknown) => {
      const validatedInput = input as WorkspaceUpdateInput;
      await this.db.updateWorkspace(validatedInput.id, validatedInput.state);
      return true;
    });

    this.ipc.setHandler('/workspace/delete', async (input: unknown) => {
      const validatedInput = input as WorkspaceDeleteInput;
      await this.db.deleteWorkspace(validatedInput.id);
      return true;
    });

    // File handlers
    this.ipc.setHandler('/file/content', async (input: unknown) => {
      const validatedInput = input as FileContentInput;
      const content = await this.db.getFileContent(
        validatedInput.workspaceId,
        validatedInput.filePath
      );
      
      if (!content) {
        throw new Error('File not found');
      }
      
      // TODO: Handle line ranges if specified
      const tokenCount = validatedInput.lineRanges ? 
        this.calculateTokensForLineRanges(content, validatedInput.lineRanges) : 
        this.estimateTokenCount(content);
      
      return {
        content,
        tokenCount,
        hash: this.calculateHash(content),
        compressed: false
      };
    });

    this.ipc.setHandler('/file/save', async (input: unknown) => {
      const validatedInput = input as FileSaveInput;
      await this.db.saveFileContent(
        validatedInput.workspaceId,
        validatedInput.filePath,
        validatedInput.content,
        validatedInput.tokenCount
      );
      return true;
    });

    // Preference handlers
    this.ipc.setHandler('/prefs/get', async (input: unknown) => {
      const validatedInput = input as PreferenceGetInput;
      return this.db.getPreference(validatedInput.key);
    });

    this.ipc.setHandler('/prefs/set', async (input: unknown) => {
      const validatedInput = input as PreferenceSetInput;
      await this.db.setPreference(
        validatedInput.key,
        validatedInput.value,
        validatedInput.encrypted
      );

      // Broadcast update to notify all renderer processes
      this.broadcastUpdate('/prefs/get:update');

      return true;
    });

    // Prompt handlers
    this.ipc.setHandler('/prompt/list', async (input: unknown) => {
      const validatedInput = input as PromptListInput;
      const allPrompts = await this.db.database.all<{
        id: string;
        type: string;
        name: string;
        content: string;
        token_count: number | null;
        is_active: number;
        created_at: number;
        updated_at: number;
      }>('SELECT * FROM prompts WHERE is_active = 1');
      
      const prompts = allPrompts
        .filter(p => !validatedInput.type || p.type === validatedInput.type)
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
      
      return prompts;
    });

    this.ipc.setHandler('/prompt/create', async (input: unknown) => {
      const validatedInput = input as PromptCreateInput;
      const id = require('crypto').randomUUID();
      const tokenCount = validatedInput.tokenCount || this.estimateTokenCount(validatedInput.content);
      
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
      const validatedInput = input as PromptUpdateInput;
      await this.db.database.run(
        `UPDATE prompts
         SET name = ?, content = ?, token_count = ?, is_active = ?
         WHERE id = ?`,
        [validatedInput.name, validatedInput.content, validatedInput.tokenCount, validatedInput.isActive ? 1 : 0, validatedInput.id]
      );

      // Broadcast update to notify all renderer processes
      const updateChannel = validatedInput.type === 'system' ? '/prompts/system:update' : '/prompts/role:update';
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

  // Helper methods
  private calculateHash(content: string): string {
    return require('crypto').createHash('sha256').update(content).digest('hex');
  }

  private estimateTokenCount(text: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private calculateTokensForLineRanges(
    content: string,
    lineRanges: Array<{ start: number; end: number }>
  ): number {
    const lines = content.split('\n');
    let selectedContent = '';
    
    for (const range of lineRanges) {
      const start = Math.max(0, range.start - 1); // Convert to 0-based
      const end = Math.min(lines.length, range.end);
      selectedContent += lines.slice(start, end).join('\n') + '\n';
    }
    
    return this.estimateTokenCount(selectedContent);
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