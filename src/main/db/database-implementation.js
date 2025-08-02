const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class PasteFlowDatabase {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.setupDatabase();
  }

  setupDatabase() {
    // Enable performance optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');

    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        folder_path TEXT,
        state TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        last_accessed INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS custom_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );


      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);
      CREATE INDEX IF NOT EXISTS idx_workspaces_last_accessed ON workspaces(last_accessed DESC);
      CREATE INDEX IF NOT EXISTS idx_workspaces_folder_path ON workspaces(folder_path);
      CREATE INDEX IF NOT EXISTS idx_preferences_key ON preferences(key);
      CREATE INDEX IF NOT EXISTS idx_preferences_updated_at ON preferences(updated_at);
      CREATE INDEX IF NOT EXISTS idx_prompts_name ON custom_prompts(name);
    `);

    // Prepare statements
    this.statements = {
      // Workspace operations
      listWorkspaces: this.db.prepare(`
        SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
        FROM workspaces 
        ORDER BY last_accessed DESC
      `),
      
      getWorkspace: this.db.prepare(`
        SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
        FROM workspaces 
        WHERE name = ? OR id = ?
      `),
      
      createWorkspace: this.db.prepare(`
        INSERT INTO workspaces (name, folder_path, state) 
        VALUES (?, ?, ?)
      `),
      
      updateWorkspace: this.db.prepare(`
        UPDATE workspaces 
        SET state = ?, updated_at = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `),
      
      deleteWorkspace: this.db.prepare(`
        DELETE FROM workspaces WHERE name = ?
      `),
      
      renameWorkspace: this.db.prepare(`
        UPDATE workspaces 
        SET name = ?, updated_at = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `),
      
      touchWorkspace: this.db.prepare(`
        UPDATE workspaces 
        SET last_accessed = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `),
      
      // Preference operations
      getPreference: this.db.prepare(`
        SELECT value FROM preferences WHERE key = ?
      `),
      
      setPreference: this.db.prepare(`
        INSERT INTO preferences (key, value) 
        VALUES (?, ?) 
        ON CONFLICT(key) DO UPDATE SET 
          value = excluded.value,
          updated_at = strftime('%s', 'now') * 1000
      `),
      
      // Optimized query for getting workspace names only
      getWorkspaceNames: this.db.prepare(`
        SELECT name FROM workspaces ORDER BY last_accessed DESC
      `),
      
    };
  }

  // Workspace methods
  listWorkspaces() {
    const rows = this.statements.listWorkspaces.all();
    return rows.map(row => ({
      ...row,
      id: String(row.id),  // Convert numeric id to string
      state: row.state ? JSON.parse(row.state) : {},
      folderPath: row.folder_path
    }));
  }

  getWorkspace(nameOrId) {
    const row = this.statements.getWorkspace.get(nameOrId, nameOrId);
    if (!row) return null;
    
    return {
      ...row,
      id: String(row.id),  // Convert numeric id to string
      state: row.state ? JSON.parse(row.state) : {},
      folderPath: row.folder_path
    };
  }

  createWorkspace(name, folderPath, state = {}) {
    const result = this.statements.createWorkspace.run(
      name,
      folderPath,
      JSON.stringify(state)
    );
    return this.getWorkspace(result.lastInsertRowid);
  }

  updateWorkspace(name, state) {
    this.statements.updateWorkspace.run(JSON.stringify(state), name);
  }

  deleteWorkspace(name) {
    this.statements.deleteWorkspace.run(name);
  }

  renameWorkspace(oldName, newName) {
    this.statements.renameWorkspace.run(newName, oldName);
  }

  touchWorkspace(name) {
    this.statements.touchWorkspace.run(name);
  }

  getWorkspaceNames() {
    const rows = this.statements.getWorkspaceNames.all();
    return rows.map(row => row.name);
  }

  // Preference methods
  getPreference(key) {
    const row = this.statements.getPreference.get(key);
    if (!row) return null;
    
    // Handle edge cases: null, undefined, empty strings
    if (row.value === null || row.value === undefined || row.value === '') {
      return null;
    }
    
    // Safely check if the value looks like JSON
    const trimmedValue = row.value.trim();
    if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[') || 
        trimmedValue === 'true' || trimmedValue === 'false' || 
        trimmedValue === 'null' || !isNaN(trimmedValue)) {
      try {
        // Validate JSON string before parsing to prevent malformed data issues
        if (typeof row.value !== 'string') {
          console.warn(`Invalid preference value type for key '${key}':`, typeof row.value);
          return row.value;
        }
        return JSON.parse(row.value);
      } catch (error) {
        console.warn(`Failed to parse JSON preference for key '${key}':`, error.message);
        // Return raw value if JSON parsing fails
        return row.value;
      }
    }
    
    // Return as plain string if not JSON-like
    return row.value;
  }

  setPreference(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.statements.setPreference.run(key, serialized);
  }


  // Cleanup
  // Transaction support for complex operations
  runInTransaction(callback) {
    const transaction = this.db.transaction(callback);
    try {
      return transaction();
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }

  // Atomic workspace state update
  updateWorkspaceAtomic(name, updates) {
    return this.runInTransaction(() => {
      // Get current workspace
      const current = this.getWorkspace(name);
      if (!current) {
        throw new Error(`Workspace '${name}' not found`);
      }

      // Merge state if provided
      let newState = current.state;
      if (updates.state) {
        newState = { ...current.state, ...updates.state };
      }

      // Update workspace - updateWorkspace prepared statement expects (state, name)
      // The updated_at is handled by the SQL statement itself using strftime
      this.statements.updateWorkspace.run(
        JSON.stringify(newState),
        name
      );

      // If folder path changed, update that too
      if (updates.folderPath && updates.folderPath !== current.folderPath) {
        const updateFolderStmt = this.db.prepare(`
          UPDATE workspaces SET folder_path = ? WHERE name = ?
        `);
        updateFolderStmt.run(updates.folderPath, name);
      }

      // Update last accessed time
      this.touchWorkspace(name);

      return this.getWorkspace(name);
    });
  }

  // Atomic operation to rename workspace and update all references
  renameWorkspaceAtomic(oldName, newName) {
    return this.runInTransaction(() => {
      // Check if new name already exists
      const existing = this.getWorkspace(newName);
      if (existing) {
        throw new Error(`Workspace '${newName}' already exists`);
      }

      // Rename the workspace
      this.statements.renameWorkspace.run(newName, oldName);

      // Return the renamed workspace
      return this.getWorkspace(newName);
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = { PasteFlowDatabase };