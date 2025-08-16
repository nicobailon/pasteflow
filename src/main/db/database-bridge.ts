import * as path from 'path';
import { app } from 'electron';
import { PasteFlowDatabase, WorkspaceState, PreferenceValue } from './database-implementation';
import { retryConnection, executeWithRetry, retryUtility } from './retry-utils';

// Define precise error types for SQLite
interface SQLiteError extends Error {
  code?: 'SQLITE_BUSY' | 'SQLITE_LOCKED' | 'SQLITE_CONSTRAINT' | 'SQLITE_CORRUPT' | string;
  errno?: number;
  syscall?: string;
}

/**
 * Async wrapper bridge for PasteFlowDatabase with initialization management.
 * Provides promise-based interface and handles database initialization with retry logic.
 * Includes fallback to in-memory database if persistent storage fails.
 */
export class DatabaseBridge {
  private db: PasteFlowDatabase | null = null;
  private initialized = false;
  private fallbackMode = false;
  private inMemoryDb: PasteFlowDatabase | null = null;
  private connectionAttempts = 0;
  private readonly maxConnectionAttempts = 5;

  /**
   * Creates a new DatabaseBridge instance.
   * Database is not initialized until initialize() is called.
   * 
   * @example
   * const bridge = new DatabaseBridge();
   * await bridge.initialize();
   */
  constructor() {
    // Empty constructor - initialization happens in initialize()
  }

  /**
   * Initializes the database connection with retry logic and fallback support.
   * Attempts to create persistent database, falls back to in-memory on failure.
   * 
   * @param maxRetries - Maximum number of initialization attempts
   * @param retryDelay - Delay between retry attempts in milliseconds
   * @throws {Error} If all initialization attempts fail including in-memory fallback
   * @example
   * await bridge.initialize(5, 2000); // 5 retries with 2s delay
   */
  async initialize(maxRetries = 3, retryDelay = 1000): Promise<void> {
    if (this.initialized) return;

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pasteflow.db');
    
    console.log('Initializing PasteFlow database at:', dbPath);
    
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create database instance and wait for initialization
        this.db = new PasteFlowDatabase(dbPath);
        await this.db.initializeDatabase();
        
        // Simple health check that doesn't rely on prepared statements
        if (this.db.db) {
          try {
            this.db.db.prepare('SELECT 1 as test').get();
          } catch (e) {
            console.warn('Database health check failed:', e);
          }
        }
        
        this.initialized = true;
        console.log('Database initialized successfully');
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(`Database initialization attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // If database is locked or busy, try to close and cleanup
          const sqliteError = error as SQLiteError;
          if (sqliteError.code === 'SQLITE_BUSY' || sqliteError.code === 'SQLITE_LOCKED') {
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
   * @returns Promise resolving to array of workspace objects
   * @throws {Error} If database not initialized or query fails
   * @example
   * const workspaces = await bridge.listWorkspaces();
   */
  async listWorkspaces() {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.listWorkspaces();
  }

  /**
   * Creates a new workspace asynchronously.
   * 
   * @param name - Unique workspace name
   * @param folderPath - Associated folder path
   * @param state - Initial workspace state
   * @returns Promise resolving to created workspace object
   * @throws {Error} If name conflicts or database operation fails
   * @example
   * const workspace = await bridge.createWorkspace('my-app', '/path/to/app');
   */
  async createWorkspace(name: string, folderPath: string, state: WorkspaceState = {}) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.createWorkspace(name, folderPath, state);
  }

  /**
   * Retrieves a workspace by name or ID asynchronously.
   * 
   * @param nameOrId - Workspace identifier
   * @returns Promise resolving to workspace object or null
   * @throws {Error} If database query fails
   * @example
   * const workspace = await bridge.getWorkspace('my-app');
   */
  async getWorkspace(nameOrId: string | number) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getWorkspace(nameOrId);
  }

  /**
   * Updates workspace state asynchronously.
   * 
   * @param name - Workspace name to update
   * @param state - New state object
   * @returns Promise that resolves when update completes
   * @throws {Error} If workspace not found or update fails
   * @example
   * await bridge.updateWorkspace('my-app', { selectedFiles: ['main.js'] });
   */
  async updateWorkspace(name: string, state: WorkspaceState) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.updateWorkspace(name, state);
  }

  /**
   * Deletes a workspace permanently.
   * 
   * @param name - Workspace name to delete
   * @returns Promise that resolves when deletion completes
   * @throws {Error} If database operation fails
   * @example
   * await bridge.deleteWorkspace('old-project');
   */
  async deleteWorkspace(name: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.deleteWorkspace(name);
  }

  /**
   * Deletes a workspace by its ID or name.
   * This operation cannot be undone.
   * 
   * @param id - Workspace ID (UUID) or name to delete
   * @returns Promise that resolves when deletion completes
   * @throws {Error} If database operation fails
   * @example
   * await bridge.deleteWorkspaceById('550e8400-e29b-41d4-a716-446655440000');
   * await bridge.deleteWorkspaceById('my-workspace');
   */
  async deleteWorkspaceById(id: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.deleteWorkspaceById(id);
  }

  /**
   * Renames a workspace with collision detection.
   * 
   * @param oldName - Current workspace name
   * @param newName - Desired new name
   * @returns Promise that resolves when rename completes
   * @throws {Error} If old workspace not found or new name conflicts
   * @example
   * await bridge.renameWorkspace('old-name', 'new-name');
   */
  async renameWorkspace(oldName: string, newName: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.renameWorkspace(oldName, newName);
  }

  /**
   * Updates workspace last access time.
   * 
   * @param name - Workspace name to touch
   * @returns Promise that resolves when touch completes
   * @throws {Error} If workspace not found
   * @example
   * await bridge.touchWorkspace('active-project');
   */
  async touchWorkspace(name: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.touchWorkspace(name);
  }

  /**
   * Retrieves workspace names for performance-optimized listings.
   * 
   * @returns Promise resolving to array of workspace names
   * @throws {Error} If database query fails
   * @example
   * const names = await bridge.getWorkspaceNames();
   */
  async getWorkspaceNames() {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getWorkspaceNames();
  }

  // Atomic operations
  /**
   * Performs atomic workspace update with state merging.
   * 
   * @param name - Workspace name to update
   * @param updates - Update object with state and/or folderPath
   * @returns Promise resolving to updated workspace object
   * @throws {Error} If workspace not found or transaction fails
   * @example
   * const updated = await bridge.updateWorkspaceAtomic('my-app', {
   *   state: { newProperty: 'value' }
   * });
   */
  async updateWorkspaceAtomic(name: string, updates: { state?: Partial<WorkspaceState>; folderPath?: string }) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.updateWorkspaceAtomic(name, updates);
  }

  /**
   * Performs atomic workspace rename with validation.
   * 
   * @param oldName - Current workspace name
   * @param newName - Desired new name
   * @returns Promise resolving to renamed workspace object
   * @throws {Error} If validation fails or transaction fails
   * @example
   * const renamed = await bridge.renameWorkspaceAtomic('old', 'new');
   */
  async renameWorkspaceAtomic(oldName: string, newName: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.renameWorkspaceAtomic(oldName, newName);
  }

  // Preferences operations
  /**
   * Retrieves a preference value with automatic type parsing.
   * 
   * @param key - Preference key to retrieve
   * @returns Promise resolving to preference value or null
   * @throws {Error} If database query fails
   * @example
   * const theme = await bridge.getPreference('ui.theme');
   */
  async getPreference(key: string): Promise<PreferenceValue> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getPreference(key);
  }

  /**
   * Stores a preference value with automatic serialization.
   * 
   * @param key - Preference key to set
   * @param value - Value to store
   * @returns Promise that resolves when preference is saved
   * @throws {Error} If database operation fails
   * @example
   * await bridge.setPreference('ui.theme', 'dark');
   */
  async setPreference(key: string, value: PreferenceValue) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.setPreference(key, value);
  }

  // Instructions operations
  /**
   * Retrieves all instructions ordered by last updated time.
   * 
   * @returns Array of instruction objects
   * @throws {Error} If database query fails
   */
  async listInstructions() {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.listInstructions();
  }

  /**
   * Creates a new instruction in the database.
   * 
   * @param id - Unique instruction identifier
   * @param name - Instruction name
   * @param content - Instruction content
   * @returns Promise that resolves when instruction is created
   * @throws {Error} If instruction creation fails
   */
  async createInstruction(id: string, name: string, content: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.createInstruction(id, name, content);
  }

  /**
   * Updates an existing instruction.
   * 
   * @param id - Instruction identifier
   * @param name - New instruction name
   * @param content - New instruction content
   * @returns Promise that resolves when instruction is updated
   * @throws {Error} If update fails
   */
  async updateInstruction(id: string, name: string, content: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.updateInstruction(id, name, content);
  }

  /**
   * Deletes an instruction from the database.
   * 
   * @param id - Instruction identifier
   * @returns Promise that resolves when instruction is deleted
   * @throws {Error} If deletion fails
   */
  async deleteInstruction(id: string) {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.deleteInstruction(id);
  }

  // Cleanup
  /**
   * Closes the database connection and cleans up resources.
   * 
   * @returns Promise that resolves when cleanup completes
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