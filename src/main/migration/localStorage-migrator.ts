import { SecureDatabase } from '../db/secure-database';
import { v4 as uuidv4 } from 'uuid';
import { ExtractedData } from './localStorage-extractor';
import type { MigrationStats } from './migration-orchestrator';

export interface DryRunResult {
  success: boolean;
  error?: string;
  stats?: {
    workspaces: number;
    prompts: number;
    preferences: number;
    estimatedDuration: number;
  };
  issues?: string[];
}

interface WorkspaceState {
  selectedFolder: string | null;
  selectedFiles: unknown[];
  expandedNodes: Record<string, boolean>;
  files: unknown[];
  tokenCount: number;
  userInstructions: string;
  customPrompts: Record<string, unknown>;
}

export class LocalStorageMigrator {
  private stats: MigrationStats = {
    workspacesMigrated: 0,
    promptsMigrated: 0,
    preferencesMigrated: 0,
    filesMigrated: 0,
    errors: 0
  };

  constructor(private db: SecureDatabase) {}

  async migrate(data: unknown): Promise<{ stats: MigrationStats }> {
    const extractedData = data as ExtractedData;
    const startTime = Date.now();
    
    try {
      await this.db.database.exec('BEGIN IMMEDIATE');

      await this.migrateWorkspaces(extractedData.workspaces);
      await this.migratePrompts(extractedData.prompts);
      await this.migratePreferences(extractedData.preferences);
      await this.migrateFileSelections(extractedData.fileSelections);
      await this.migrateInstructions(extractedData.instructions);
      
      await this.db.database.exec('COMMIT');

      const duration = Date.now() - startTime;

      return {
        stats: {
          ...this.stats,
          duration,
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      await this.db.database.exec('ROLLBACK');
      throw error;
    }
  }

  private async migrateWorkspaces(workspaces: Record<string, unknown>) {
    for (const [name, state] of Object.entries(workspaces)) {
      try {
        const id = uuidv4();
        const now = Math.floor(Date.now() / 1000);
        
        const validatedState = this.validateWorkspaceState(state);
        
        await this.db.database.run(`
          INSERT INTO workspaces 
          (id, name, folder_path, state_json, created_at, updated_at, last_accessed)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          id,
          name,
          validatedState.selectedFolder || '',
          JSON.stringify(validatedState),
          now,
          now,
          now
        ]);

        if (validatedState.files && Array.isArray(validatedState.files)) {
          await this.migrateWorkspaceFiles(id, validatedState.files);
        }

        this.stats.workspacesMigrated++;
      } catch (error) {
        console.error(`Failed to migrate workspace "${name}":`, error);
        this.stats.errors++;
      }
    }
  }

  private async migrateWorkspaceFiles(workspaceId: string, files: unknown[]) {
    const fileInsertStmt = await this.db.database.prepare(`
      INSERT INTO files 
      (path, workspace_id, size, is_binary, token_count, last_modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      try {
        const fileData = file as Record<string, unknown>;
        await fileInsertStmt.run(
          fileData.path as string,
          workspaceId,
          (fileData.size as number) || 0,
          fileData.isBinary ? 1 : 0,
          (fileData.tokenCount as number) || null,
          (fileData.lastModified as number) || Date.now()
        );
        
        this.stats.filesMigrated++;
      } catch (error) {
        console.error(`Failed to migrate file:`, error);
        this.stats.errors++;
      }
    }

    await fileInsertStmt.finalize();
  }

  private async migratePrompts(prompts: ExtractedData['prompts']) {
    const promptInsertStmt = await this.db.database.prepare(`
      INSERT INTO prompts 
      (id, type, name, content, token_count, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const prompt of prompts.system) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const isActive = prompts.active.systemIds.includes(prompt.id);
        
        const tokenCount = prompt.tokenCount || await this.estimateTokenCount(prompt.content);
        
        await promptInsertStmt.run(
          prompt.id || uuidv4(),
          'system',
          prompt.name,
          prompt.content,
          tokenCount,
          isActive ? 1 : 0,
          prompt.createdAt || now,
          prompt.updatedAt || now
        );
        
        this.stats.promptsMigrated++;
      } catch (error) {
        console.error(`Failed to migrate system prompt "${prompt.name}":`, error);
        this.stats.errors++;
      }
    }

    for (const prompt of prompts.role) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const isActive = prompts.active.roleIds.includes(prompt.id);
        
        const tokenCount = prompt.tokenCount || await this.estimateTokenCount(prompt.content);
        
        await promptInsertStmt.run(
          prompt.id || uuidv4(),
          'role',
          prompt.name,
          prompt.content,
          tokenCount,
          isActive ? 1 : 0,
          prompt.createdAt || now,
          prompt.updatedAt || now
        );
        
        this.stats.promptsMigrated++;
      } catch (error) {
        console.error(`Failed to migrate role prompt "${prompt.name}":`, error);
        this.stats.errors++;
      }
    }

    await promptInsertStmt.finalize();
  }

  private async migratePreferences(preferences: Record<string, unknown>) {
    const prefInsertStmt = await this.db.database.prepare(`
      INSERT INTO preferences (key, value, encrypted, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const [key, value] of Object.entries(preferences)) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const stringValue = typeof value === 'string' 
          ? value 
          : JSON.stringify(value);
        
        await prefInsertStmt.run(
          key,
          stringValue,
          0,
          now
        );
        
        this.stats.preferencesMigrated++;
      } catch (error) {
        console.error(`Failed to migrate preference "${key}":`, error);
        this.stats.errors++;
      }
    }

    await prefInsertStmt.finalize();
  }

  private async migrateFileSelections(fileSelections: unknown[]) {
    if (!Array.isArray(fileSelections) || fileSelections.length === 0) {
      return;
    }

    const currentWorkspace = await this.db.database.get(
      'SELECT id FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
    );

    if (!currentWorkspace) {
      console.warn('No workspace found for file selections');
      return;
    }

    const selectionStmt = await this.db.database.prepare(`
      INSERT INTO workspace_selections 
      (workspace_id, file_path, line_ranges, created_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const selection of fileSelections) {
      try {
        const selectionData = selection as Record<string, unknown>;
        const now = Math.floor(Date.now() / 1000);
        
        await selectionStmt.run(
          currentWorkspace.id,
          selectionData.path as string,
          selectionData.lines ? JSON.stringify(selectionData.lines) : null,
          now
        );
      } catch (error) {
        console.error('Failed to migrate file selection:', error);
        this.stats.errors++;
      }
    }

    await selectionStmt.finalize();
  }

  private async migrateInstructions(instructions: unknown[]) {
    if (!Array.isArray(instructions) || instructions.length === 0) {
      return;
    }

    const instructionStmt = await this.db.database.prepare(`
      INSERT INTO instructions 
      (id, content, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const instruction of instructions) {
      try {
        const instructionData = instruction as Record<string, unknown>;
        const now = Math.floor(Date.now() / 1000);
        
        await instructionStmt.run(
          instructionData.id || uuidv4(),
          instructionData.content as string,
          instructionData.createdAt || now,
          now
        );
      } catch (error) {
        console.error('Failed to migrate instruction:', error);
        this.stats.errors++;
      }
    }

    await instructionStmt.finalize();
  }

  private validateWorkspaceState(state: unknown): WorkspaceState {
    const stateData = state as Record<string, unknown>;
    return {
      selectedFolder: (stateData.selectedFolder as string) || null,
      selectedFiles: Array.isArray(stateData.selectedFiles) 
        ? stateData.selectedFiles 
        : [],
      expandedNodes: (stateData.expandedNodes as Record<string, boolean>) || {},
      files: Array.isArray(stateData.files) ? stateData.files : [],
      tokenCount: (stateData.tokenCount as number) || 0,
      userInstructions: (stateData.userInstructions as string) || '',
      customPrompts: (stateData.customPrompts as Record<string, unknown>) || {}
    };
  }

  private async estimateTokenCount(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  async dryRun(data: unknown): Promise<DryRunResult> {
    const extractedData = data as ExtractedData;
    const issues: string[] = [];
    let estimatedDuration = 0;

    const workspaceCount = Object.keys(extractedData.workspaces).length;
    estimatedDuration += workspaceCount * 50;

    const promptCount = extractedData.prompts.system.length + extractedData.prompts.role.length;
    estimatedDuration += promptCount * 20;

    if (workspaceCount > 100) {
      issues.push(`Large number of workspaces (${workspaceCount}) may take longer`);
    }

    for (const [name, state] of Object.entries(extractedData.workspaces)) {
      const workspaceState = state as Record<string, unknown>;
      if (!workspaceState.selectedFolder) {
        issues.push(`Workspace "${name}" missing folder path`);
      }
    }

    return {
      success: issues.length === 0,
      stats: {
        workspaces: workspaceCount,
        prompts: promptCount,
        preferences: Object.keys(extractedData.preferences).length,
        estimatedDuration
      },
      issues
    };
  }
}