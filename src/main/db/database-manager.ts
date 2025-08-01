import { SecureDatabase } from './secure-database';
import { SecureIpcLayer } from '../ipc/secure-ipc';
import { StateHandlers } from '../handlers/state-handlers';
import { MigrationOrchestrator } from '../migration/migration-orchestrator';
import * as path from 'path';
import { app } from 'electron';

export class DatabaseManager {
  private db!: SecureDatabase;
  private ipc!: SecureIpcLayer;
  private stateHandlers!: StateHandlers;
  private migrationOrchestrator!: MigrationOrchestrator;
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
    
    // Initialize migration orchestrator
    this.migrationOrchestrator = new MigrationOrchestrator(this.db);
    
    // Check if migration is needed
    const needsMigration = await this.migrationOrchestrator.checkMigrationNeeded();
    if (needsMigration) {
      console.log('Data migration required, starting migration process...');
      const result = await this.migrationOrchestrator.startMigration();
      if (!result.success) {
        console.error('Migration failed:', result.error);
        throw new Error(`Data migration failed: ${result.error}`);
      }
      console.log('Migration completed successfully', result.stats);
    }
    
    // Initialize IPC layer
    this.ipc = new SecureIpcLayer();
    
    // Initialize state handlers
    this.stateHandlers = new StateHandlers(this.db, this.ipc);
    
    // Wire up legacy IPC handlers to database operations
    this.setupHandlers();
    
    console.log('Database and IPC layer initialized successfully');
  }

  private setupHandlers() {
    // Workspace handlers
    this.ipc.setHandler('/workspace/list', async () => {
      return this.db.listWorkspaces();
    });

    this.ipc.setHandler('/workspace/create', async (input) => {
      const id = await this.db.createWorkspace(
        input.name,
        input.folderPath,
        input.state || {}
      );
      
      const workspace = await this.db.getWorkspace(id);
      if (!workspace) {
        throw new Error('Failed to create workspace');
      }
      
      return workspace;
    });

    this.ipc.setHandler('/workspace/load', async (input) => {
      const workspace = await this.db.getWorkspace(input.id);
      if (!workspace) {
        throw new Error('Workspace not found');
      }
      return workspace;
    });

    this.ipc.setHandler('/workspace/update', async (input) => {
      await this.db.updateWorkspace(input.id, input.state);
      return true;
    });

    this.ipc.setHandler('/workspace/delete', async (input) => {
      await this.db.deleteWorkspace(input.id);
      return true;
    });

    // File handlers
    this.ipc.setHandler('/file/content', async (input) => {
      const content = await this.db.getFileContent(
        input.workspaceId,
        input.filePath
      );
      
      if (!content) {
        throw new Error('File not found');
      }
      
      // TODO: Handle line ranges if specified
      const tokenCount = input.lineRanges ? 
        this.calculateTokensForLineRanges(content, input.lineRanges) : 
        this.estimateTokenCount(content);
      
      return {
        content,
        tokenCount,
        hash: this.calculateHash(content),
        compressed: false
      };
    });

    this.ipc.setHandler('/file/save', async (input) => {
      await this.db.saveFileContent(
        input.workspaceId,
        input.filePath,
        input.content,
        input.tokenCount
      );
      return true;
    });

    // Preference handlers
    this.ipc.setHandler('/prefs/get', async (input) => {
      return this.db.getPreference(input.key);
    });

    this.ipc.setHandler('/prefs/set', async (input) => {
      await this.db.setPreference(
        input.key,
        input.value,
        input.encrypted
      );
      return true;
    });

    // Prompt handlers
    this.ipc.setHandler('/prompt/list', async (input) => {
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
        .filter(p => !input.type || p.type === input.type)
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

    this.ipc.setHandler('/prompt/create', async (input) => {
      const id = require('crypto').randomUUID();
      const tokenCount = input.tokenCount || this.estimateTokenCount(input.content);
      
      await this.db.database.run(
        `INSERT INTO prompts (id, type, name, content, token_count, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.type, input.name, input.content, tokenCount, input.isActive ? 1 : 0]
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

    this.ipc.setHandler('/prompt/update', async (input) => {
      await this.db.database.run(
        `UPDATE prompts 
         SET name = ?, content = ?, token_count = ?, is_active = ?
         WHERE id = ?`,
        [input.name, input.content, input.tokenCount, input.isActive ? 1 : 0, input.id]
      );
      return true;
    });

    this.ipc.setHandler('/prompt/delete', async (input) => {
      await this.db.database.run('DELETE FROM prompts WHERE id = ?', [input.id]);
      return true;
    });

    // Migration handlers
    this.ipc.setHandler('/migration/retry', async () => {
      const result = await this.migrationOrchestrator.startMigration();
      return result;
    });

    this.ipc.setHandler('/migration/restore', async () => {
      const backupManager = await import('../migration/backup-manager');
      const manager = new backupManager.BackupManager();
      const backups = await manager.getBackupList();
      
      if (backups.length > 0) {
        await manager.restoreFromBackup(backups[0].path);
        return { success: true, message: 'Restored from latest backup' };
      }
      
      return { success: false, message: 'No backups available' };
    });
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
}