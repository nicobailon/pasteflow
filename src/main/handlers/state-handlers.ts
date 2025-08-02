import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SecureDatabase } from '../db/secure-database';
import { SecureIpcLayer } from '../ipc/secure-ipc';
import { countTokens } from '../utils/token-utils';

interface ContentDeduplicator {
  storeFileContent(content: string, filePath: string): Promise<string>;
  retrieveContent(hash: string): Promise<string>;
}

export class StateHandlers {
  private contentDeduplicator: ContentDeduplicator;
  
  private estimateTokenCount(text: string): number {
    return countTokens(text);
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
      const workspaces = await this.db.database.all(
        'SELECT id, name, folder_path as folderPath, state_json, created_at as createdAt, updated_at as updatedAt, last_accessed as lastAccessed FROM workspaces ORDER BY last_accessed DESC'
      );
      
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
    });

    this.ipc.setHandler('/workspace/create', async (input) => {
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
    });

    this.ipc.setHandler('/workspace/load', async (input) => {
      const workspace = await this.db.database.get(
        'SELECT * FROM workspaces WHERE id = ?',
        [input.id]
      );
      
      if (!workspace) {
        throw new Error('Workspace not found');
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
    });

    this.ipc.setHandler('/workspace/update', async (input) => {
      const now = Math.floor(Date.now() / 1000);
      
      await this.db.database.run(
        'UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(input.state), now, input.id]
      );
      
      return true;
    });

    this.ipc.setHandler('/workspace/delete', async (input) => {
      await this.db.database.run('DELETE FROM workspaces WHERE id = ?', [input.id]);
      return true;
    });

    this.ipc.setHandler('/workspace/current', async () => {
      // Get the most recently accessed workspace
      const workspace = await this.db.database.get(
        'SELECT * FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
      );
      
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
    });

    this.ipc.setHandler('/workspace/set-current', async (input) => {
      // Update the current workspace state
      const workspace = await this.db.database.get(
        'SELECT id FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
      );
      
      if (workspace) {
        const now = Math.floor(Date.now() / 1000);
        await this.db.database.run(
          'UPDATE workspaces SET state_json = ?, updated_at = ?, last_accessed = ? WHERE id = ?',
          [JSON.stringify(input.workspace), now, now, workspace.id]
        );
      }
      
      return true;
    });

    this.ipc.setHandler('/workspace/clear', async () => {
      // Clear current workspace by setting state to empty
      const workspace = await this.db.database.get(
        'SELECT id FROM workspaces ORDER BY last_accessed DESC LIMIT 1'
      );
      
      if (workspace) {
        const now = Math.floor(Date.now() / 1000);
        await this.db.database.run(
          'UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify({}), now, workspace.id]
        );
      }
      
      return true;
    });

    this.ipc.setHandler('/workspace/touch', async (input) => {
      const now = Math.floor(Date.now() / 1000);
      await this.db.database.run(
        'UPDATE workspaces SET last_accessed = ? WHERE id = ?',
        [now, input.id]
      );
      return true;
    });

    this.ipc.setHandler('/workspace/rename', async (input) => {
      await this.db.database.run(
        'UPDATE workspaces SET name = ? WHERE id = ?',
        [input.newName, input.id]
      );
      return true;
    });

    // File content handlers
    this.ipc.setHandler('/file/content', async (input) => {
      // Check if content exists in database
      const file = await this.db.database.get(
        'SELECT content_hash, token_count FROM files WHERE workspace_id = ? AND path = ?',
        [input.workspaceId, input.filePath]
      );
      
      if (file && file.content_hash) {
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
      }
      
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
    });

    // Prompt handlers
    this.ipc.setHandler('/prompts/system', async () => {
      const prompts = await this.db.database.all(
        'SELECT * FROM prompts WHERE type = ? AND is_active = 1',
        ['system']
      );
      
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
    });

    this.ipc.setHandler('/prompts/role', async () => {
      const prompts = await this.db.database.all(
        'SELECT * FROM prompts WHERE type = ? AND is_active = 1',
        ['role']
      );
      
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
    });

    this.ipc.setHandler('/prompts/system/add', async (input) => {
      const now = Math.floor(Date.now() / 1000);
      const tokenCount = countTokens(input.content);
      
      await this.db.database.run(
        'INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [input.id, 'system', input.name, input.content, tokenCount, input.isActive ? 1 : 0, now, now]
      );
      
      // Notify all windows
      this.broadcastUpdate('/prompts/system:update');
      
      return true;
    });

    this.ipc.setHandler('/prompts/system/update', async (input) => {
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
        fields.push('content = ?');
        values.push(updates.content);
        fields.push('token_count = ?');
        values.push(countTokens(updates.content as string));
      }
      if ('isActive' in updates) {
        fields.push('is_active = ?');
        values.push(updates.isActive ? 1 : 0);
      }
      
      fields.push('updated_at = ?');
      values.push(now);
      values.push(input.id);
      
      await this.db.database.run(
        `UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      
      this.broadcastUpdate('/prompts/system:update');
      return true;
    });

    this.ipc.setHandler('/prompts/system/delete', async (input) => {
      await this.db.database.run('DELETE FROM prompts WHERE id = ?', [input.id]);
      this.broadcastUpdate('/prompts/system:update');
      return true;
    });

    // Role prompt handlers (similar pattern)
    this.ipc.setHandler('/prompts/role/add', async (input) => {
      const now = Math.floor(Date.now() / 1000);
      const tokenCount = countTokens(input.content);
      
      await this.db.database.run(
        'INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [input.id, 'role', input.name, input.content, tokenCount, input.isActive ? 1 : 0, now, now]
      );
      
      this.broadcastUpdate('/prompts/role:update');
      return true;
    });

    this.ipc.setHandler('/prompts/role/update', async (input) => {
      const now = Math.floor(Date.now() / 1000);
      const updates = input.updates;
      
      const fields: string[] = [];
      const values: unknown[] = [];
      
      if ('name' in updates) {
        fields.push('name = ?');
        values.push(updates.name);
      }
      if ('content' in updates) {
        fields.push('content = ?');
        values.push(updates.content);
        fields.push('token_count = ?');
        values.push(countTokens(updates.content as string));
      }
      if ('isActive' in updates) {
        fields.push('is_active = ?');
        values.push(updates.isActive ? 1 : 0);
      }
      
      fields.push('updated_at = ?');
      values.push(now);
      values.push(input.id);
      
      await this.db.database.run(
        `UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      
      this.broadcastUpdate('/prompts/role:update');
      return true;
    });

    this.ipc.setHandler('/prompts/role/delete', async (input) => {
      await this.db.database.run('DELETE FROM prompts WHERE id = ?', [input.id]);
      this.broadcastUpdate('/prompts/role:update');
      return true;
    });

    // Active prompts handlers
    this.ipc.setHandler('/prompts/active', async () => {
      // Get active prompt selections from preferences
      const systemPromptIds = await this.db.getPreference('active_system_prompts') || [];
      const rolePromptIds = await this.db.getPreference('active_role_prompts') || [];
      
      return {
        systemPromptIds,
        rolePromptIds
      };
    });

    this.ipc.setHandler('/prompts/active/update', async (input) => {
      await this.db.setPreference('active_system_prompts', input.systemPromptIds);
      await this.db.setPreference('active_role_prompts', input.rolePromptIds);
      
      this.broadcastUpdate('/prompts/active:update');
      return true;
    });

    this.ipc.setHandler('/prompts/active/clear', async () => {
      await this.db.setPreference('active_system_prompts', []);
      await this.db.setPreference('active_role_prompts', []);
      
      this.broadcastUpdate('/prompts/active:update');
      return true;
    });

    // Preference handlers
    this.ipc.setHandler('/prefs/get', async (input) => {
      const pref = await this.db.database.get(
        'SELECT value, encrypted FROM preferences WHERE key = ?',
        [input.key]
      );
      
      if (!pref) {
        return null;
      }
      
      let value = pref.value;
      
      if (pref.encrypted) {
        // Decrypt value using secure database method
        value = await this.db.decryptValue(value);
      }
      
      return JSON.parse(value);
    });

    this.ipc.setHandler('/prefs/set', async (input) => {
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
      
      return true;
    });

    // Selection state handlers
    this.ipc.setHandler('/workspace/selection', async () => {
      const selection = await this.db.getPreference('workspace_selection') || {
        selectedFiles: [],
        lastModified: Date.now()
      };
      
      return selection;
    });

    this.ipc.setHandler('/workspace/selection/update', async (input) => {
      await this.db.setPreference('workspace_selection', input);
      
      this.broadcastUpdate('/workspace/selection:update', input);
      return true;
    });

    this.ipc.setHandler('/workspace/selection/clear', async () => {
      const cleared = {
        selectedFiles: [],
        lastModified: Date.now()
      };
      
      await this.db.setPreference('workspace_selection', cleared);
      
      this.broadcastUpdate('/workspace/selection:update', cleared);
      return true;
    });
  }

  private broadcastUpdate(channel: string, data?: unknown) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(channel, data);
    });
  }
}