const path = require('path');
const { app } = require('electron');
const { PasteFlowDatabase } = require('./database-implementation.js');

class DatabaseBridge {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pasteflow.db');
    
    console.log('Initializing PasteFlow database at:', dbPath);
    
    try {
      // Create database instance
      this.db = new PasteFlowDatabase(dbPath);
      
      this.initialized = true;
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
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