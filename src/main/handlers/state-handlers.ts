import { promises as fs } from 'node:fs';

import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';

import { SecureDatabase } from '../db/secure-database';
import { SecureIpcLayer } from '../ipc/secure-ipc';
import { countTokens } from '../utils/token-utils';
// Removed custom validation imports - using Zod validation from SecureIpcLayer instead

interface ContentDeduplicator {
  storeFileContent(content: string, filePath: string): Promise<string>;
  retrieveContent(hash: string): Promise<string>;
}

export class StateHandlers {
  private contentDeduplicator: ContentDeduplicator;
  
  private estimateTokenCount(text: string): number {
    return countTokens(text);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async findWorkspaceByIdOrName(idOrName: string) {
    // Case-insensitive, trimmed name matching; id is exact
    return await this.db.database.get(
      // NOTE: LOWER(TRIM(?)) avoids casing/whitespace mismatches on names
      'SELECT * FROM workspaces WHERE id = ? OR LOWER(name) = LOWER(TRIM(?)) LIMIT 1',
      [idOrName, idOrName]
    ) as {
      id: string;
      name: string;
      folder_path: string;
      state_json: string;
      created_at: number;
      updated_at: number;
      last_accessed: number;
    } | undefined;
  }

  constructor(
    private db: SecureDatabase,
    private ipc: SecureIpcLayer
  ) {
    this.contentDeduplicator = {
      storeFileContent: async (content: string, filePath: string) => {
        return await this.db.saveFileContentByHash(content, filePath);
      },
      retrieveContent: async (hash: string) => {
        return await this.db.getContentByHash(hash);
      }
    };
    this.registerHandlers();
  }

  private registerHandlers() {
    // Workspace handlers
    this.ipc.setHandler('/workspace/list', async () => {
      try {
        const workspaces = await this.db.database.all(
          'SELECT id, name, folder_path as folderPath, state_json, created_at as createdAt, updated_at as updatedAt, last_accessed as lastAccessed FROM workspaces ORDER BY last_accessed DESC'
        ) as {
          id: string;
          name: string;
          folderPath: string;
          state_json: string;
          createdAt: number;
          updatedAt: number;
          lastAccessed: number;
        }[];
        
        // Parse the state JSON for each workspace
        return workspaces.map(ws => ({
          id: ws.id,
          name: ws.name,
          folderPath: ws.folderPath,
          state: JSON.parse(ws.state_json || '{}'),
          createdAt: ws.createdAt,
          updatedAt: ws.updatedAt,
          lastAccessed: ws.lastAccessed
        }));
      } catch (error) {
        throw new Error(`Failed to list workspaces: ${(error as Error).message}. Check database connection and table integrity.`);
      }
    });

    // Input already validated by SecureIpcLayer (Zod). Use directly.
    this.ipc.setHandler('/workspace/create', async (input: { name: string; folderPath: string; state?: unknown }) => {
      try {
        const id = uuidv4();
        const now = Math.floor(Date.now() / 1000);

        await this.db.database.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json, created_at, updated_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, input.name, input.folderPath, JSON.stringify(input.state || {}), now, now, now]
        );

        return {
          id,
          name: input.name,
          folderPath: input.folderPath,
          state: input.state || {},
          createdAt: now,
          updatedAt: now,
          lastAccessed: now
        };
      } catch (error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          const name = input?.name ?? '<unknown>';
          throw new Error(`Cannot create workspace '${name}': A workspace with this name already exists. Choose a different name.`);
        }
        const name = input?.name ?? '<unknown>';
        const folderPath = input?.folderPath ?? '<unknown>';
        throw new Error(`Failed to create workspace '${name}' at '${folderPath}': ${err.message || 'Unknown error'}. Verify folder path is valid and database is writable.`);
      }
    });

    // Zod validated (input.id is non-empty string; transitional: may be name or UUID)
    this.ipc.setHandler('/workspace/load', async (input: { id: string }) => {
      try {
        let workspace = await this.findWorkspaceByIdOrName(input.id);

        if (!workspace) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id);
          if (!isUuid) {
            const maxAttempts = 3;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              await this.delay(50 + attempt * 50);
              workspace = await this.findWorkspaceByIdOrName(input.id);
              if (workspace) break;
            }
          }
        }

        if (!workspace) {
          return null;
        }

        return {
          id: workspace.id,
          name: workspace.name,
          folderPath: workspace.folder_path,
          state: JSON.parse(workspace.state_json),
          createdAt: workspace.created_at,
          updatedAt: workspace.updated_at,
          lastAccessed: workspace.last_accessed
        };
      } catch (error) {
        const errorMessage = (error as Error).message;
        throw new Error(`Failed to load workspace '${input.id}': ${errorMessage}. Check database connection and workspace data integrity.`);
      }
    });

    // Zod validated (input.id is UUID per schemas; input.state is a record)
    this.ipc.setHandler('/workspace/update', async (input: { id: string; state: Record<string, unknown> }) => {
      try {
        const now = Math.floor(Date.now() / 1000);

        const result = await this.db.database.run(
          'UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(input.state), now, input.id]
        );

        if (result.changes === 0) {
          throw new Error(`Workspace '${input.id}' not found during update operation. Verify workspace exists before updating.`);
        }

        // Broadcast update to notify all renderer processes
        this.broadcastUpdate('/workspace/current:update');

        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to update workspace '${input.id}': ${errorMessage}. Check workspace state format and database permissions.`);
      }
    });

    // Zod validated (input.id is UUID per schemas)
    this.ipc.setHandler('/workspace/delete', async (input: { id: string }) => {
      try {
        const result = await this.db.database.run('DELETE FROM workspaces WHERE id = ?', [input.id]);

        if (result.changes === 0) {
          throw new Error(`Workspace '${input.id}' not found during delete operation. Workspace may have already been deleted.`);
        }

        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to delete workspace '${input.id}': ${errorMessage}. Check database permissions and workspace references.`);
      }
    });

    this.ipc.setHandler('/workspace/current', async () => {
      try {
        // Get the most recently accessed workspace
        const workspace = await this.db.database.get(
          'SELECT * FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
        ) as {
          id: string;
          name: string;
          folder_path: string;
          state_json: string;
          created_at: number;
          updated_at: number;
          last_accessed: number;
        } | undefined;
        
        if (!workspace) {
          return null;
        }
        
        return {
          id: workspace.id,
          name: workspace.name,
          folderPath: workspace.folder_path,
          state: JSON.parse(workspace.state_json),
          createdAt: workspace.created_at,
          updatedAt: workspace.updated_at,
          lastAccessed: workspace.last_accessed
        };
      } catch (error) {
        throw new Error(`Failed to get current workspace: ${(error as Error).message}. Check database connection and workspace data integrity.`);
      }
    });

    this.ipc.setHandler('/workspace/set-current', async (input: { workspace: any }) => {
      let workspace: { id: string; name: string } | undefined;
      try {
        // Update the current workspace state
        workspace = await this.db.database.get(
          'SELECT id, name FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
        ) as { id: string; name: string } | undefined;
        
        if (workspace) {
          const now = Math.floor(Date.now() / 1000);
          await this.db.database.run(
            'UPDATE workspaces SET state_json = ?, updated_at = ?, last_accessed = ? WHERE id = ?',
            [JSON.stringify(input.workspace), now, now, workspace.id]
          );
        }
        
        return true;
      } catch (error) {
        const workspaceName = workspace?.name || 'current workspace';
        throw new Error(`Failed to set current workspace '${workspaceName}': ${(error as Error).message}. Check workspace data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/workspace/clear', async () => {
      let workspace: { id: string; name: string } | undefined;
      try {
        // Clear current workspace by setting state to empty
        workspace = await this.db.database.get(
          'SELECT id, name FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
        ) as { id: string; name: string } | undefined;
        
        if (workspace) {
          const now = Math.floor(Date.now() / 1000);
          await this.db.database.run(
            'UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?',
            [JSON.stringify({}), now, workspace.id]
          );
        }
        
        return true;
      } catch (error) {
        const workspaceName = workspace?.name || 'current workspace';
        throw new Error(`Failed to clear workspace '${workspaceName}': ${(error as Error).message}. Check database permissions.`);
      }
    });

    // Zod validated in SecureIpcLayer
    this.ipc.setHandler('/workspace/exists', async (input: { name: string }) => {
      try {
        const workspace = await this.findWorkspaceByIdOrName(input.name);
        return { exists: workspace !== undefined, id: workspace?.id };
      } catch {
        // Don't throw errors for existence checks - just return false
        return { exists: false, id: undefined };
      }
    });

    this.ipc.setHandler('/workspace/touch', async (input: { id: string }) => {
      try {
        const now = Math.floor(Date.now() / 1000);

        // If the identifier is not a UUID, resolve it by name first
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id);

        let targetId = input.id;
        if (!isUuid) {
          const row = await this.db.database.get(
            'SELECT id FROM workspaces WHERE LOWER(name) = LOWER(TRIM(?)) LIMIT 1',
            [input.id]
          ) as { id: string } | undefined;
          if (row?.id) {
            targetId = row.id;
          }
        }

        const result = await this.db.database.run(
          'UPDATE workspaces SET last_accessed = ? WHERE id = ?',
          [now, targetId]
        );
        
        if (result.changes === 0) {
          throw new Error(`Workspace '${input.id}' not found during access time update. Workspace may have been deleted.`);
        }

        // Broadcast update to notify all renderer processes
        this.broadcastUpdate('/workspace/current:update');

        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to update access time for workspace '${input.id}': ${errorMessage}. Check database permissions.`);
      }
    });

    this.ipc.setHandler('/workspace/rename', async (input: { id: string; newName: string }) => {
      try {
        const result = await this.db.database.run(
          'UPDATE workspaces SET name = ? WHERE id = ?',
          [input.newName, input.id]
        );
        
        if (result.changes === 0) {
          throw new Error(`Workspace '${input.id}' not found during rename operation. Verify workspace exists before renaming.`);
        }
        
        return true;
      } catch (error) {
        const err = error as { code?: string; message?: string };
        const errorMessage = err.message || 'Unknown error';
        if (errorMessage.includes('not found')) {
          throw error;
        }
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`Cannot rename workspace to '${input.newName}': A workspace with this name already exists. Choose a different name.`);
        }
        throw new Error(`Failed to rename workspace '${input.id}' to '${input.newName}': ${errorMessage}. Check for name conflicts and database permissions.`);
      }
    });

    // File content handlers
    this.ipc.setHandler('/file/content', async (input: { workspaceId: string; filePath: string; lineRanges?: { start: number; end: number }[] }) => {
      try {
        // Check if content exists in database
        const file = await this.db.database.get(
          'SELECT content_hash, token_count FROM files WHERE workspace_id = ? AND path = ?',
          [input.workspaceId, input.filePath]
        ) as { content_hash: string; token_count: number } | undefined;
        
        if (file?.content_hash) {
          try {
            // Retrieve from content store
            const content = await this.contentDeduplicator.retrieveContent(file.content_hash);
            
            // Apply line ranges if specified
            if (input.lineRanges) {
              const lines = content.split('\n');
              const selectedLines = input.lineRanges.flatMap(range => 
                lines.slice(range.start - 1, range.end)
              );
              
              return {
                content: selectedLines.join('\n'),
                tokenCount: this.estimateTokenCount(selectedLines.join('\n')),
                hash: file.content_hash,
                compressed: true
              };
            }
            
            return {
              content,
              tokenCount: file.token_count,
              hash: file.content_hash,
              compressed: true
            };
          } catch (contentError) {
            throw new Error(`Failed to retrieve cached content for file '${input.filePath}' in workspace '${input.workspaceId}': ${(contentError as Error).message}. Falling back to filesystem.`);
          }
        }
      } catch (dbError) {
        console.warn(`Database lookup failed for file '${input.filePath}' in workspace '${input.workspaceId}': ${(dbError as Error).message}. Loading from filesystem.`);
      }
      
      try {
        // Load from file system
        const content = await fs.readFile(input.filePath, 'utf8');
        const tokenCount = countTokens(content);
        
        // Store for future use
        const hash = await this.contentDeduplicator.storeFileContent(
          content,
          input.filePath
        );
        
        await this.db.database.run(
          'INSERT OR REPLACE INTO files (path, workspace_id, content_hash, size, is_binary, token_count) VALUES (?, ?, ?, ?, ?, ?)',
          [input.filePath, input.workspaceId, hash, content.length, false, tokenCount]
        );
        
        return {
          content,
          tokenCount,
          hash,
          compressed: false
        };
      } catch (error) {
        throw new Error(`Failed to load file content from '${input.filePath}' for workspace '${input.workspaceId}': ${(error as Error).message}. Verify file exists and is readable.`);
      }
    });

    // Prompt handlers
    this.ipc.setHandler('/prompts/system', async () => {
      try {
        const prompts = await this.db.database.all(
          'SELECT * FROM prompts WHERE type = ? AND is_active = 1',
          ['system']
        ) as {
          id: string;
          type: string;
          name: string;
          content: string;
          token_count: number;
          is_active: number;
          created_at: number;
          updated_at: number;
        }[];
        
        return prompts.map(p => ({
          id: p.id,
          type: p.type,
          name: p.name,
          content: p.content,
          tokenCount: p.token_count,
          isActive: p.is_active === 1,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        }));
      } catch (error) {
        throw new Error(`Failed to load system prompts: ${(error as Error).message}. Check database connection and prompts table integrity.`);
      }
    });

    this.ipc.setHandler('/prompts/role', async () => {
      try {
        const prompts = await this.db.database.all(
          'SELECT * FROM prompts WHERE type = ? AND is_active = 1',
          ['role']
        ) as {
          id: string;
          type: string;
          name: string;
          content: string;
          token_count: number;
          is_active: number;
          created_at: number;
          updated_at: number;
        }[];
        
        return prompts.map(p => ({
          id: p.id,
          type: p.type,
          name: p.name,
          content: p.content,
          tokenCount: p.token_count,
          isActive: p.is_active === 1,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        }));
      } catch (error) {
        throw new Error(`Failed to load role prompts: ${(error as Error).message}. Check database connection and prompts table integrity.`);
      }
    });

    this.ipc.setHandler('/prompts/system/add', async (input: { id: string; name: string; content: string; isActive?: boolean }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const tokenCount = countTokens(input.content);
        
        await this.db.database.run(
          'INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [input.id, 'system', input.name, input.content, tokenCount, input.isActive ? 1 : 0, now, now]
        );
        
        // Notify all windows
        this.broadcastUpdate('/prompts/system:update');
        
        return true;
      } catch (error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`Cannot add system prompt '${input.name}': A prompt with this ID already exists. Use update operation instead.`);
        }
        throw new Error(`Failed to add system prompt '${input.name}': ${err.message || 'Unknown error'}. Check prompt data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/prompts/system/update', async (input: { id: string; updates: { name?: string; content?: string; isActive?: boolean } }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const updates = input.updates;
        
        // Build dynamic update query
        const fields: string[] = [];
        const values: unknown[] = [];
        
        if ('name' in updates) {
          fields.push('name = ?');
          values.push(updates.name);
        }
        if ('content' in updates) {
          fields.push('content = ?', 'token_count = ?');
          values.push(updates.content, countTokens(updates.content as string));
        }
        if ('isActive' in updates) {
          fields.push('is_active = ?');
          values.push(updates.isActive ? 1 : 0);
        }
        
        fields.push('updated_at = ?');
        values.push(now, input.id);
        
        const result = await this.db.database.run(
          `UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`,
          values
        );
        
        if (result.changes === 0) {
          throw new Error(`System prompt '${input.id}' not found during update operation. Verify prompt exists before updating.`);
        }
        
        this.broadcastUpdate('/prompts/system:update');
        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to update system prompt '${input.id}': ${errorMessage}. Check prompt data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/prompts/system/delete', async (input: { id: string }) => {
      try {
        const result = await this.db.database.run('DELETE FROM prompts WHERE id = ?', [input.id]);
        
        if (result.changes === 0) {
          throw new Error(`System prompt '${input.id}' not found during delete operation. Prompt may have already been deleted.`);
        }
        
        this.broadcastUpdate('/prompts/system:update');
        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to delete system prompt '${input.id}': ${errorMessage}. Check database permissions and prompt references.`);
      }
    });

    // Role prompt handlers (similar pattern)
    this.ipc.setHandler('/prompts/role/add', async (input: { id: string; name: string; content: string; isActive?: boolean }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const tokenCount = countTokens(input.content);
        
        await this.db.database.run(
          'INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [input.id, 'role', input.name, input.content, tokenCount, input.isActive ? 1 : 0, now, now]
        );
        
        this.broadcastUpdate('/prompts/role:update');
        return true;
      } catch (error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`Cannot add role prompt '${input.name}': A prompt with this ID already exists. Use update operation instead.`);
        }
        throw new Error(`Failed to add role prompt '${input.name}': ${err.message || 'Unknown error'}. Check prompt data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/prompts/role/update', async (input: { id: string; updates: { name?: string; content?: string; isActive?: boolean } }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const updates = input.updates;
        
        const fields: string[] = [];
        const values: unknown[] = [];
        
        if ('name' in updates) {
          fields.push('name = ?');
          values.push(updates.name);
        }
        if ('content' in updates) {
          fields.push('content = ?', 'token_count = ?');
          values.push(updates.content, countTokens(updates.content as string));
        }
        if ('isActive' in updates) {
          fields.push('is_active = ?');
          values.push(updates.isActive ? 1 : 0);
        }
        
        fields.push('updated_at = ?');
        values.push(now, input.id);
        
        const result = await this.db.database.run(
          `UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`,
          values
        );
        
        if (result.changes === 0) {
          throw new Error(`Role prompt '${input.id}' not found during update operation. Verify prompt exists before updating.`);
        }
        
        this.broadcastUpdate('/prompts/role:update');
        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to update role prompt '${input.id}': ${errorMessage}. Check prompt data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/prompts/role/delete', async (input: { id: string }) => {
      try {
        const result = await this.db.database.run('DELETE FROM prompts WHERE id = ?', [input.id]);
        
        if (result.changes === 0) {
          throw new Error(`Role prompt '${input.id}' not found during delete operation. Prompt may have already been deleted.`);
        }
        
        this.broadcastUpdate('/prompts/role:update');
        return true;
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
          throw error;
        }
        throw new Error(`Failed to delete role prompt '${input.id}': ${errorMessage}. Check database permissions and prompt references.`);
      }
    });

    // Active prompts handlers
    this.ipc.setHandler('/prompts/active', async () => {
      try {
        // Get active prompt selections from preferences
        const systemPromptIds = await this.db.getPreference('active_system_prompts') || [];
        const rolePromptIds = await this.db.getPreference('active_role_prompts') || [];
        
        return {
          systemPromptIds,
          rolePromptIds
        };
      } catch (error) {
        throw new Error(`Failed to get active prompts: ${(error as Error).message}. Check database connection and preferences table.`);
      }
    });

    this.ipc.setHandler('/prompts/active/update', async (input: { systemPromptIds?: string[]; rolePromptIds?: string[] }) => {
      try {
        await this.db.setPreference('active_system_prompts', input.systemPromptIds);
        await this.db.setPreference('active_role_prompts', input.rolePromptIds);
        
        this.broadcastUpdate('/prompts/active:update');
        return true;
      } catch (error) {
        throw new Error(`Failed to update active prompts (system: ${input.systemPromptIds?.length || 0}, role: ${input.rolePromptIds?.length || 0}): ${(error as Error).message}. Check prompt IDs and database permissions.`);
      }
    });

    this.ipc.setHandler('/prompts/active/clear', async () => {
      try {
        await this.db.setPreference('active_system_prompts', []);
        await this.db.setPreference('active_role_prompts', []);
        
        this.broadcastUpdate('/prompts/active:update');
        return true;
      } catch (error) {
        throw new Error(`Failed to clear active prompts: ${(error as Error).message}. Check database permissions.`);
      }
    });

    // Instructions handlers
    this.ipc.setHandler('/instructions/list', async () => {
      try {
        const items = await this.db.database.listInstructions();
        // Map DB snake_case fields to API camelCase schema
        return items.map((row: any) => ({
          id: row.id,
          name: row.name,
          content: row.content,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
      } catch (error) {
        throw new Error(`Failed to list instructions: ${(error as Error).message}`);
      }
    });

    this.ipc.setHandler('/instructions/create', async (input: { id: string; name: string; content: string }) => {
      try {
        await this.db.database.createInstruction(input.id, input.name, input.content);

        // Broadcast update to notify all renderer processes
        this.broadcastUpdate('/instructions/list:update');

        return { success: true };
      } catch (error) {
        throw new Error(`Failed to create instruction: ${(error as Error).message}`);
      }
    });

    this.ipc.setHandler('/instructions/update', async (input: { id: string; name: string; content: string }) => {
      try {
        await this.db.database.updateInstruction(input.id, input.name, input.content);

        // Broadcast update to notify all renderer processes
        this.broadcastUpdate('/instructions/list:update');

        return { success: true };
      } catch (error) {
        throw new Error(`Failed to update instruction: ${(error as Error).message}`);
      }
    });

    this.ipc.setHandler('/instructions/delete', async (input: { id: string }) => {
      try {
        await this.db.database.deleteInstruction(input.id);
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to delete instruction: ${(error as Error).message}`);
      }
    });

    // Preference handlers
    this.ipc.setHandler('/prefs/get', async (input: { key: string }) => {
      try {
        const pref = await this.db.database.get(
          'SELECT value, encrypted FROM preferences WHERE key = ?',
          [input.key]
        ) as { value: string; encrypted: number } | undefined;
        
        if (!pref) {
          return null;
        }
        
        let value = pref.value;
        
        if (pref.encrypted) {
          // Decrypt value using secure database method
          value = await this.db.decryptValue(value);
        }
        
        return JSON.parse(value);
      } catch (error) {
        throw new Error(`Failed to get preference '${input.key}': ${(error as Error).message}. Check key format and database connection.`);
      }
    });

    this.ipc.setHandler('/prefs/set', async (input: { key: string; value: unknown; encrypted?: boolean }) => {
      try {
        let value = JSON.stringify(input.value);

        if (input.encrypted) {
          // Encrypt sensitive values
          value = await this.db.encryptValue(value);
        }

        const now = Math.floor(Date.now() / 1000);

        await this.db.database.run(
          'INSERT OR REPLACE INTO preferences (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)',
          [input.key, value, input.encrypted ? 1 : 0, now]
        );

        // Broadcast update to notify all renderer processes
        this.broadcastUpdate('/prefs/get:update');

        return true;
      } catch (error) {
        throw new Error(`Failed to set preference '${input.key}': ${(error as Error).message}. Check value format and database permissions.`);
      }
    });

    // Selection state handlers
    this.ipc.setHandler('/workspace/selection', async () => {
      try {
        return await this.db.getPreference('workspace_selection') || {
          selectedFiles: [],
          lastModified: Date.now()
        };
      } catch (error) {
        throw new Error(`Failed to get workspace selection: ${(error as Error).message}. Check database connection and preferences.`);
      }
    });

    this.ipc.setHandler('/workspace/selection/update', async (input: { selectedFiles?: unknown[]; lastModified?: number }) => {
      try {
        await this.db.setPreference('workspace_selection', input);
        
        this.broadcastUpdate('/workspace/selection:update', input);
        return true;
      } catch (error) {
        const fileCount = input?.selectedFiles?.length || 0;
        throw new Error(`Failed to update workspace selection (${fileCount} files): ${(error as Error).message}. Check selection data format and database permissions.`);
      }
    });

    this.ipc.setHandler('/workspace/selection/clear', async () => {
      try {
        const cleared = {
          selectedFiles: [],
          lastModified: Date.now()
        };
        
        await this.db.setPreference('workspace_selection', cleared);
        
        this.broadcastUpdate('/workspace/selection:update', cleared);
        return true;
      } catch (error) {
        throw new Error(`Failed to clear workspace selection: ${(error as Error).message}. Check database permissions.`);
      }
    });
  }

  private broadcastUpdate(channel: string, data?: unknown) {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send(channel, data);
    }
  }
}