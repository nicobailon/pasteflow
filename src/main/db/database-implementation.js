const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { retryTransaction, retryConnection, executeWithRetry } = require('./retry-utils.js');

/**
 * SQLite database implementation for PasteFlow workspace and preference management.
 * Provides optimized performance with WAL mode, prepared statements, and indexes.
 * All timestamps are stored as Unix milliseconds for consistency across platforms.
 */
class PasteFlowDatabase {
  /**
   * Creates a new PasteFlowDatabase instance and initializes the schema with retry support.
   * 
   * @param {string} dbPath - Path to the SQLite database file (use ':memory:' for in-memory)
   * @throws {Error} If database cannot be created or schema setup fails
   * @example
   * const db = new PasteFlowDatabase('/path/to/pasteflow.db');
   * // or for testing
   * const testDb = new PasteFlowDatabase(':memory:');
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  async initializeDatabase() {
    // Return existing promise if initialization is already in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // Store the promise to prevent concurrent initialization
    this.initializationPromise = this._performInitialization();
    return this.initializationPromise;
  }

  async _performInitialization() {
    try {
      this.db = await retryConnection(() => {
        const db = new Database(this.dbPath);
        // Test connection with a simple query
        db.prepare('SELECT 1').get();
        return db;
      });
      
      await this.setupDatabase();
      this.isInitialized = true;
      console.log('Database initialized successfully with retry support');
    } catch (error) {
      console.error('Failed to initialize database after all retries:', error);
      throw new Error(`Database initialization failed: ${error.message}`);
    }
  }

  ensureInitialized() {
    if (!this.isInitialized || !this.db) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
  }

  /**
   * Initializes database schema, performance optimizations, and prepared statements.
   * Sets up WAL mode for better concurrency and creates all required tables and indexes.
   * 
   * @private
   * @throws {Error} If schema creation or statement preparation fails
   */
  async setupDatabase() {
    if (!this.db) {
      throw new Error('Database connection not established');
    }

    // Enable performance optimizations with retry
    await executeWithRetry(async () => {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000'); // 64MB cache
      this.db.pragma('temp_store = MEMORY');
    }, {
      operation: 'setup_database_pragmas',
      maxRetries: 3
    });

    // Create tables if they don't exist with retry
    await executeWithRetry(async () => {
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
    }, {
      operation: 'create_database_schema',
      maxRetries: 3
    });

    // Prepare statements with retry
    await this.prepareStatements();
  }

  async prepareStatements() {
    await executeWithRetry(async () => {
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
    }, {
      operation: 'prepare_statements',
      maxRetries: 3
    });
  }

  // Workspace methods
  /**
   * Retrieves all workspaces ordered by last accessed time (most recent first) with retry support.
   * Includes full workspace metadata and parsed state objects.
   * 
   * @returns {Promise<Array<Object>>} Array of workspace objects with properties:
   *   - id {string}: Unique workspace identifier
   *   - name {string}: Workspace display name
   *   - folderPath {string}: Associated folder path
   *   - state {Object}: Parsed workspace state
   *   - created_at {number}: Creation timestamp (Unix ms)
   *   - updated_at {number}: Last update timestamp (Unix ms)
   *   - last_accessed {number}: Last access timestamp (Unix ms)
   * @throws {Error} If database query fails after all retry attempts
   * @example
   * const workspaces = await db.listWorkspaces();
   * workspaces.forEach(ws => console.log(`${ws.name}: ${ws.folderPath}`));
   */
  async listWorkspaces() {
    this.ensureInitialized();
    
    return await executeWithRetry(async () => {
      const rows = this.statements.listWorkspaces.all();
      return rows.map(row => ({
        ...row,
        id: String(row.id),  // Convert numeric id to string
        state: row.state ? JSON.parse(row.state) : {},
        folderPath: row.folder_path
      }));
    }, {
      operation: 'list_workspaces',
      maxRetries: 3
    });
  }

  /**
   * Retrieves a single workspace by name or ID.
   * Performs case-sensitive lookup and returns null if not found.
   * 
   * @param {string|number} nameOrId - Workspace name or numeric ID
   * @returns {Object|null} Workspace object with parsed state, or null if not found
   * @throws {Error} If database query fails
   * @example
   * const workspace = db.getWorkspace('my-project');
   * if (workspace) {
   *   console.log('Found workspace:', workspace.name);
   * }
   */
  getWorkspace(nameOrId) {
    try {
      const row = this.statements.getWorkspace.get(nameOrId, nameOrId);
      if (!row) return null;
      
      return {
        ...row,
        id: String(row.id),  // Convert numeric id to string
        state: row.state ? JSON.parse(row.state) : {},
        folderPath: row.folder_path
      };
    } catch (error) {
      throw new Error(`Failed to retrieve workspace '${nameOrId}': ${error.message}. Check database connection and workspace existence.`);
    }
  }

  /**
   * Creates a new workspace with the specified configuration.
   * Workspace names must be unique - duplicate names will cause a constraint violation.
   * 
   * @param {string} name - Unique workspace name
   * @param {string} folderPath - Associated folder path
   * @param {Object} [state={}] - Initial workspace state object
   * @returns {Object} Newly created workspace object with generated ID
   * @throws {Error} If name already exists or database operation fails
   * @example
   * const workspace = db.createWorkspace(
   *   'my-project',
   *   '/path/to/project',
   *   { selectedFiles: ['src/main.js'] }
   * );
   */
  createWorkspace(name, folderPath, state = {}) {
    try {
      const result = this.statements.createWorkspace.run(
        name,
        folderPath,
        JSON.stringify(state)
      );
      return this.getWorkspace(result.lastInsertRowid);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Cannot create workspace '${name}': A workspace with this name already exists. Choose a different name.`);
      }
      throw new Error(`Failed to create workspace '${name}' at '${folderPath}': ${error.message}. Verify folder path is valid and database is writable.`);
    }
  }

  /**
   * Updates workspace state and automatically sets updated_at timestamp.
   * Does not modify other workspace properties like name or folderPath.
   * 
   * @param {string} name - Workspace name to update
   * @param {Object} state - New state object (will be JSON serialized)
   * @throws {Error} If workspace not found or database operation fails
   * @example
   * db.updateWorkspace('my-project', {
   *   selectedFiles: ['src/main.js', 'src/utils.js'],
   *   expandedNodes: { 'src': true }
   * });
   */
  updateWorkspace(name, state) {
    try {
      const result = this.statements.updateWorkspace.run(JSON.stringify(state), name);
      if (result.changes === 0) {
        throw new Error(`Workspace '${name}' not found during update operation. Verify workspace exists before updating.`);
      }
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to update workspace '${name}': ${error.message}. Check workspace state format and database permissions.`);
    }
  }

  /**
   * Permanently deletes a workspace and all associated data.
   * This operation cannot be undone.
   * 
   * @param {string} name - Workspace name to delete
   * @throws {Error} If database operation fails
   * @example
   * db.deleteWorkspace('old-project');
   */
  deleteWorkspace(name) {
    try {
      const result = this.statements.deleteWorkspace.run(name);
      if (result.changes === 0) {
        throw new Error(`Workspace '${name}' not found during delete operation. Workspace may have already been deleted.`);
      }
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to delete workspace '${name}': ${error.message}. Check database permissions and workspace references.`);
    }
  }

  /**
   * Renames a workspace and updates the modified timestamp.
   * New name must be unique across all workspaces.
   * 
   * @param {string} oldName - Current workspace name
   * @param {string} newName - New workspace name (must be unique)
   * @throws {Error} If old workspace not found, new name exists, or database operation fails
   * @example
   * db.renameWorkspace('old-name', 'new-name');
   */
  renameWorkspace(oldName, newName) {
    try {
      const result = this.statements.renameWorkspace.run(newName, oldName);
      if (result.changes === 0) {
        throw new Error(`Workspace '${oldName}' not found during rename operation. Verify workspace exists before renaming.`);
      }
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Cannot rename workspace '${oldName}' to '${newName}': A workspace with the new name already exists. Choose a different name.`);
      }
      throw new Error(`Failed to rename workspace '${oldName}' to '${newName}': ${error.message}. Check database permissions and name conflicts.`);
    }
  }

  /**
   * Updates the last_accessed timestamp for a workspace to the current time.
   * Used to track workspace usage for sorting by recency.
   * 
   * @param {string} name - Workspace name to touch
   * @throws {Error} If workspace not found or database operation fails
   * @example
   * db.touchWorkspace('my-project'); // Updates last_accessed to now
   */
  touchWorkspace(name) {
    try {
      const result = this.statements.touchWorkspace.run(name);
      if (result.changes === 0) {
        throw new Error(`Workspace '${name}' not found during access time update. Workspace may have been deleted.`);
      }
    } catch (error) {
      if (error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to update access time for workspace '${name}': ${error.message}. Check database permissions.`);
    }
  }

  /**
   * Retrieves only workspace names in last-accessed order for performance.
   * Much faster than listWorkspaces() when only names are needed.
   * 
   * @returns {Array<string>} Array of workspace names ordered by last access
   * @throws {Error} If database query fails
   * @example
   * const names = db.getWorkspaceNames();
   * // ['recent-project', 'older-project', ...]
   */
  getWorkspaceNames() {
    try {
      const rows = this.statements.getWorkspaceNames.all();
      return rows.map(row => row.name);
    } catch (error) {
      throw new Error(`Failed to retrieve workspace names: ${error.message}. Check database connection and table integrity.`);
    }
  }

  // Preference methods
  /**
   * Retrieves a preference value by key with intelligent type parsing.
   * Automatically detects and parses JSON values while preserving plain strings.
   * Returns null for missing keys or invalid JSON.
   * 
   * @param {string} key - Preference key to retrieve
   * @returns {*} Parsed preference value (Object, Array, string, number, boolean, or null)
   * @throws {Error} If database query fails
   * @example
   * const theme = db.getPreference('ui.theme'); // 'dark'
   * const config = db.getPreference('app.settings'); // { autoSave: true }
   * const missing = db.getPreference('nonexistent'); // null
   */
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
        console.warn(`Failed to parse JSON preference for key '${key}': ${error.message}. Returning raw value instead.`);
        // Return raw value if JSON parsing fails
        return row.value;
      }
    }
    
    // Return as plain string if not JSON-like
    return row.value;
  }

  /**
   * Stores a preference value with automatic JSON serialization for complex types.
   * Uses UPSERT to update existing keys or insert new ones atomically.
   * 
   * @param {string} key - Preference key to set
   * @param {*} value - Value to store (objects/arrays are JSON serialized)
   * @throws {Error} If database operation fails
   * @example
   * db.setPreference('ui.theme', 'dark'); // Stores as string
   * db.setPreference('app.settings', { autoSave: true }); // Stores as JSON
   */
  setPreference(key, value) {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      this.statements.setPreference.run(key, serialized);
    } catch (error) {
      throw new Error(`Failed to set preference '${key}': ${error.message}. Check value format and database permissions.`);
    }
  }


  // Transaction support for complex operations
  /**
   * Executes a callback function within a database transaction.
   * Automatically rolls back on errors and commits on success.
   * 
   * @param {Function} callback - Function to execute in transaction context
   * @returns {*} Return value from the callback function
   * @throws {Error} If transaction fails or callback throws
   * @example
   * const result = db.runInTransaction(() => {
   *   db.createWorkspace('ws1', '/path1');
   *   db.createWorkspace('ws2', '/path2');
   *   return 'both created';
   * });
   */
  runInTransaction(callback) {
    const transaction = this.db.transaction(callback);
    try {
      return transaction();
    } catch (error) {
      console.error(`Transaction failed during database operation: ${error.message}`);
      throw new Error(`Database transaction failed: ${error.message}. Check database integrity and retry operation.`);
    }
  }

  /**
   * Atomically updates workspace properties with state merging and validation.
   * Merges new state with existing state and updates folder path if provided.
   * All changes are performed in a single transaction.
   * 
   * @param {string} name - Workspace name to update
   * @param {Object} updates - Update object with optional properties:
   *   - state {Object}: Partial state to merge with existing state
   *   - folderPath {string}: New folder path to set
   * @returns {Object} Updated workspace object
   * @throws {Error} If workspace not found or transaction fails
   * @example
   * const updated = db.updateWorkspaceAtomic('my-project', {
   *   state: { selectedFiles: ['new-file.js'] },
   *   folderPath: '/new/path'
   * });
   */
  updateWorkspaceAtomic(name, updates) {
    return this.runInTransaction(() => {
      // Get current workspace
      const current = this.getWorkspace(name);
      if (!current) {
        throw new Error(`Workspace '${name}' not found during atomic update. Verify workspace exists before updating state.`);
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

  /**
   * Atomically renames a workspace with collision detection.
   * Validates that the new name doesn't conflict with existing workspaces.
   * 
   * @param {string} oldName - Current workspace name
   * @param {string} newName - Desired new name
   * @returns {Object} Renamed workspace object
   * @throws {Error} If old workspace not found, new name exists, or transaction fails
   * @example
   * const renamed = db.renameWorkspaceAtomic('old-name', 'new-name');
   */
  renameWorkspaceAtomic(oldName, newName) {
    return this.runInTransaction(() => {
      // Check if new name already exists
      const existing = this.getWorkspace(newName);
      if (existing) {
        throw new Error(`Cannot rename workspace '${oldName}' to '${newName}': Target workspace name already exists. Choose a different name.`);
      }

      // Rename the workspace
      this.statements.renameWorkspace.run(newName, oldName);

      // Return the renamed workspace
      return this.getWorkspace(newName);
    });
  }

  /**
   * Closes the database connection and releases all resources.
   * Should be called when the database is no longer needed.
   * 
   * @throws {Error} If close operation fails
   * @example
   * db.close(); // Clean shutdown
   */
  close() {
    this.db.close();
  }
}

module.exports = { PasteFlowDatabase };