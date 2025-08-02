const path = require('path');
const { app } = require('electron');
const { PasteFlowDatabase } = require('./database-implementation.js');

class DatabaseBridge {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize(maxRetries = 3, retryDelay = 1000) {
    if (this.initialized) return;

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pasteflow.db');
    
    console.log('Initializing PasteFlow database at:', dbPath);
    
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create database instance
        this.db = new PasteFlowDatabase(dbPath);
        
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
      this.initialized = true;
      console.warn('Database initialized in memory mode - data will not persist');
    } catch (memoryError) {
      console.error('Failed to initialize in-memory database:', memoryError);
      throw lastError || new Error('Database initialization failed');
    }
  }

  // Workspace operations
  async listWorkspaces() {
    return this.db.listWorkspaces();
  }

  async createWorkspace(name, folderPath, state = {}) {
    return this.db.createWorkspace(name, folderPath, state);
  }

  async getWorkspace(nameOrId) {
    return this.db.getWorkspace(nameOrId);
  }

  async updateWorkspace(name, state) {
    return this.db.updateWorkspace(name, state);
  }

  async deleteWorkspace(name) {
    return this.db.deleteWorkspace(name);
  }

  async renameWorkspace(oldName, newName) {
    return this.db.renameWorkspace(oldName, newName);
  }

  async touchWorkspace(name) {
    return this.db.touchWorkspace(name);
  }

  async getWorkspaceNames() {
    return this.db.getWorkspaceNames();
  }

  // Atomic operations
  async updateWorkspaceAtomic(name, updates) {
    return this.db.updateWorkspaceAtomic(name, updates);
  }

  async renameWorkspaceAtomic(oldName, newName) {
    return this.db.renameWorkspaceAtomic(oldName, newName);
  }

  // Preferences operations
  async getPreference(key) {
    return this.db.getPreference(key);
  }

  async setPreference(key, value) {
    return this.db.setPreference(key, value);
  }


  // Cleanup
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { DatabaseBridge };