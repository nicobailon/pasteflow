const path = require('path');
const { app } = require('electron');
const { PasteFlowDatabase } = require('./database-implementation.js');
const { retryConnection, executeWithRetry, retryUtility } = require('./retry-utils.js');

/**
 * Async wrapper bridge for PasteFlowDatabase with initialization management.
 * Provides promise-based interface and handles database initialization with retry logic.
 * Includes fallback to in-memory database if persistent storage fails.
 */
class DatabaseBridge {
  /**
   * Creates a new DatabaseBridge instance.
   * Database is not initialized until initialize() is called.
   * 
   * @example
   * const bridge = new DatabaseBridge();
   * await bridge.initialize();
   */
  constructor() {
    this.db = null;
    this.initialized = false;
    this.fallbackMode = false;
    this.inMemoryDb = null;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
  }

  /**
   * Initializes the database connection with retry logic and fallback support.
   * Attempts to create persistent database, falls back to in-memory on failure.
   * 
   * @param {number} [maxRetries=3] - Maximum number of initialization attempts
   * @param {number} [retryDelay=1000] - Delay between retry attempts in milliseconds
   * @throws {Error} If all initialization attempts fail including in-memory fallback
   * @example
   * await bridge.initialize(5, 2000); // 5 retries with 2s delay
   */
  async initialize(maxRetries = 3, retryDelay = 1000) {
    if (this.initialized) return;

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pasteflow.db');
    
    console.log('Initializing PasteFlow database at:', dbPath);
    
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create database instance and wait for initialization
        this.db = new PasteFlowDatabase(dbPath);
        await this.db.initializeDatabase();
        
        // Verify database is accessible with a simple query
        await this.db.getPreference('_health_check');
        
        this.initialized = true;
        console.log('Database initialized successfully');
        return;
      } catch (error) {
        lastError = error;
        console.error(`Database initialization attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // If database is locked or busy, try to close and cleanup
          if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
            try {
              if (this.db) {
                this.db.close();
                this.db = null;
              }
            } catch (closeError) {
              console.error('Error closing database during retry:', closeError);
            }
          }
        }
      }
    }
    
    // All retries failed - attempt fallback to in-memory database
    console.error('All database initialization attempts failed, trying in-memory fallback');
    try {
      this.db = new PasteFlowDatabase(':memory:');
      await this.db.initializeDatabase();
      this.initialized = true;
      console.warn('Database initialized in memory mode - data will not persist');
    } catch (memoryError) {
      console.error('Failed to initialize in-memory database:', memoryError);
      throw lastError || new Error('Database initialization failed');
    }
  }

  // Workspace operations
  /**
   * Retrieves all workspaces with full metadata in async context.
   * 
   * @returns {Promise<Array<Object>>} Promise resolving to array of workspace objects
   * @throws {Error} If database not initialized or query fails
   * @example
   * const workspaces = await bridge.listWorkspaces();
   */
  async listWorkspaces() {
    return this.db.listWorkspaces();
  }

  /**
   * Creates a new workspace asynchronously.
   * 
   * @param {string} name - Unique workspace name
   * @param {string} folderPath - Associated folder path
   * @param {Object} [state={}] - Initial workspace state
   * @returns {Promise<Object>} Promise resolving to created workspace object
   * @throws {Error} If name conflicts or database operation fails
   * @example
   * const workspace = await bridge.createWorkspace('my-app', '/path/to/app');
   */
  async createWorkspace(name, folderPath, state = {}) {
    return this.db.createWorkspace(name, folderPath, state);
  }

  /**
   * Retrieves a workspace by name or ID asynchronously.
   * 
   * @param {string|number} nameOrId - Workspace identifier
   * @returns {Promise<Object|null>} Promise resolving to workspace object or null
   * @throws {Error} If database query fails
   * @example
   * const workspace = await bridge.getWorkspace('my-app');
   */
  async getWorkspace(nameOrId) {
    return this.db.getWorkspace(nameOrId);
  }

  /**
   * Updates workspace state asynchronously.
   * 
   * @param {string} name - Workspace name to update
   * @param {Object} state - New state object
   * @returns {Promise<void>} Promise that resolves when update completes
   * @throws {Error} If workspace not found or update fails
   * @example
   * await bridge.updateWorkspace('my-app', { selectedFiles: ['main.js'] });
   */
  async updateWorkspace(name, state) {
    return this.db.updateWorkspace(name, state);
  }

  /**
   * Deletes a workspace permanently.
   * 
   * @param {string} name - Workspace name to delete
   * @returns {Promise<void>} Promise that resolves when deletion completes
   * @throws {Error} If database operation fails
   * @example
   * await bridge.deleteWorkspace('old-project');
   */
  async deleteWorkspace(name) {
    return this.db.deleteWorkspace(name);
  }

  /**
   * Renames a workspace with collision detection.
   * 
   * @param {string} oldName - Current workspace name
   * @param {string} newName - Desired new name
   * @returns {Promise<void>} Promise that resolves when rename completes
   * @throws {Error} If old workspace not found or new name conflicts
   * @example
   * await bridge.renameWorkspace('old-name', 'new-name');
   */
  async renameWorkspace(oldName, newName) {
    return this.db.renameWorkspace(oldName, newName);
  }

  /**
   * Updates workspace last access time.
   * 
   * @param {string} name - Workspace name to touch
   * @returns {Promise<void>} Promise that resolves when touch completes
   * @throws {Error} If workspace not found
   * @example
   * await bridge.touchWorkspace('active-project');
   */
  async touchWorkspace(name) {
    return this.db.touchWorkspace(name);
  }

  /**
   * Retrieves workspace names for performance-optimized listings.
   * 
   * @returns {Promise<Array<string>>} Promise resolving to array of workspace names
   * @throws {Error} If database query fails
   * @example
   * const names = await bridge.getWorkspaceNames();
   */
  async getWorkspaceNames() {
    return this.db.getWorkspaceNames();
  }

  // Atomic operations
  /**
   * Performs atomic workspace update with state merging.
   * 
   * @param {string} name - Workspace name to update
   * @param {Object} updates - Update object with state and/or folderPath
   * @returns {Promise<Object>} Promise resolving to updated workspace object
   * @throws {Error} If workspace not found or transaction fails
   * @example
   * const updated = await bridge.updateWorkspaceAtomic('my-app', {
   *   state: { newProperty: 'value' }
   * });
   */
  async updateWorkspaceAtomic(name, updates) {
    return this.db.updateWorkspaceAtomic(name, updates);
  }

  /**
   * Performs atomic workspace rename with validation.
   * 
   * @param {string} oldName - Current workspace name
   * @param {string} newName - Desired new name
   * @returns {Promise<Object>} Promise resolving to renamed workspace object
   * @throws {Error} If validation fails or transaction fails
   * @example
   * const renamed = await bridge.renameWorkspaceAtomic('old', 'new');
   */
  async renameWorkspaceAtomic(oldName, newName) {
    return this.db.renameWorkspaceAtomic(oldName, newName);
  }

  // Preferences operations
  /**
   * Retrieves a preference value with automatic type parsing.
   * 
   * @param {string} key - Preference key to retrieve
   * @returns {Promise<*>} Promise resolving to preference value or null
   * @throws {Error} If database query fails
   * @example
   * const theme = await bridge.getPreference('ui.theme');
   */
  async getPreference(key) {
    return this.db.getPreference(key);
  }

  /**
   * Stores a preference value with automatic serialization.
   * 
   * @param {string} key - Preference key to set
   * @param {*} value - Value to store
   * @returns {Promise<void>} Promise that resolves when preference is saved
   * @throws {Error} If database operation fails
   * @example
   * await bridge.setPreference('ui.theme', 'dark');
   */
  async setPreference(key, value) {
    return this.db.setPreference(key, value);
  }


  // Cleanup
  /**
   * Closes the database connection and cleans up resources.
   * 
   * @returns {Promise<void>} Promise that resolves when cleanup completes
   * @example
   * await bridge.close();
   */
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { DatabaseBridge };