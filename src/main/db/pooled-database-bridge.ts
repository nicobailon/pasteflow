import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { app } from 'electron';

import { PooledDatabase, PooledDatabaseConfig } from './pooled-database';
import { QueryResult, SqlParameters } from './connection-pool';

export interface DatabaseBridgeConfig extends PooledDatabaseConfig {
  maxRetries?: number;
  retryDelay?: number;
  enableBackup?: boolean;
  backupInterval?: number;
  enableMaintenance?: boolean;
  maintenanceInterval?: number;
}

// Precise types for workspace operations
export interface WorkspaceRecord extends QueryResult {
  id: string;
  name: string;
  folder_path: string;
  state: string;
  created_at: number;
  updated_at: number;
  last_accessed: number;
}

export interface PreferenceRecord extends QueryResult {
  key: string;
  value: string;
}

export interface WorkspaceState {
  selectedFolder?: string;
  selectedFiles?: {
    path: string;
    lines?: { start: number; end: number }[];
  }[];
  expandedNodes?: Record<string, boolean>;
  userInstructions?: string;
  customPrompts?: Record<string, string>;
}

export class PooledDatabaseBridge extends EventEmitter {
  private db: PooledDatabase | null = null;
  private initialized = false;
  private config: DatabaseBridgeConfig;
  private dbPath: string;
  private backupTimer: NodeJS.Timeout | null = null;
  private maintenanceTimer: NodeJS.Timeout | null = null;

  constructor(config: DatabaseBridgeConfig = {}) {
    super();
    
    this.config = {
      minReadConnections: 3,
      maxReadConnections: 15,
      maxWaitingClients: 50,
      acquireTimeout: 15_000,
      idleTimeout: 300_000,
      healthCheckInterval: 30_000,
      enablePerformanceMonitoring: true,
      logSlowQueries: true,
      slowQueryThreshold: 100,
      enableQueryCache: true,
      queryCacheSize: 1000,
      queryCacheTTL: 300_000,
      maxRetries: 3,
      retryDelay: 1000,
      enableBackup: true,
      backupInterval: 3_600_000, // 1 hour
      enableMaintenance: true,
      maintenanceInterval: 1_800_000, // 30 minutes
      ...config
    };

    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'pasteflow.db');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('Initializing Pooled PasteFlow database at:', this.dbPath);
    
    let lastError: Error;
    for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
      try {
        // Create pooled database instance
        this.db = new PooledDatabase(this.dbPath, this.config);
        
        // Set up event forwarding
        this.setupEventForwarding();
        
        // Initialize the connection pool
        await this.db.initialize();
        
        // Verify database is accessible with a simple query
        await this.db.get<{ test: number }>('SELECT 1 as test');
        
        this.initialized = true;
        console.log('Pooled database initialized successfully');
        
        // Start background tasks
        this.startBackgroundTasks();
        
        this.emit('initialized', {
          attempt,
          stats: this.db.getStats(),
          performance: this.db.getPerformanceMetrics()
        });
        
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(`Database initialization attempt ${attempt}/${this.config.maxRetries} failed:`, error);
        
        if (attempt < this.config.maxRetries!) {
          console.log(`Retrying in ${this.config.retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          
          // Cleanup failed attempt
          if (this.db) {
            try {
              await this.db.shutdown();
            } catch (shutdownError) {
              console.error('Error during cleanup:', shutdownError);
            }
            this.db = null;
          }
        }
      }
    }
    
    // All retries failed - attempt fallback to in-memory database
    console.error('All database initialization attempts failed, trying in-memory fallback');
    try {
      this.db = new PooledDatabase(':memory:', this.config);
      this.setupEventForwarding();
      await this.db.initialize();
      this.initialized = true;
      console.warn('Database initialized in memory mode - data will not persist');
      
      this.emit('fallbackInitialized', {
        reason: lastError!.message,
        stats: this.db.getStats()
      });
    } catch (memoryError) {
      console.error('Failed to initialize in-memory database:', memoryError);
      this.emit('initializationFailed', {
        primaryError: lastError!.message,
        fallbackError: (memoryError as Error).message
      });
      throw lastError!;
    }
  }

  private setupEventForwarding(): void {
    if (!this.db) return;

    // Forward performance and health events
    this.db.on('slowQuery', (data) => this.emit('slowQuery', data));
    this.db.on('cacheHit', (data) => this.emit('cacheHit', data));
    this.db.on('cacheInvalidated', (data) => this.emit('cacheInvalidated', data));
    this.db.on('connectionCreated', (data) => this.emit('connectionCreated', data));
    this.db.on('connectionRemoved', (data) => this.emit('connectionRemoved', data));
    this.db.on('healthCheck', (data) => this.emit('healthCheck', data));
    this.db.on('queryError', (data) => this.emit('queryError', data));
  }

  private startBackgroundTasks(): void {
    if (this.config.enableBackup) {
      this.backupTimer = setInterval(() => {
        this.performBackup().catch(error => {
          console.error('Backup failed:', error);
          this.emit('backupFailed', { error: error.message });
        });
      }, this.config.backupInterval!);
    }

    if (this.config.enableMaintenance) {
      this.maintenanceTimer = setInterval(() => {
        this.performMaintenance().catch(error => {
          console.error('Maintenance failed:', error);
          this.emit('maintenanceFailed', { error: error.message });
        });
      }, this.config.maintenanceInterval!);
    }
  }

  private async performBackup(): Promise<void> {
    if (!this.db || this.dbPath === ':memory:') return;

    try {
      const backupDir = path.join(path.dirname(this.dbPath), 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
      const backupPath = path.join(backupDir, `pasteflow-${timestamp}.db`);
      
      // Simple file copy backup (SQLite handles this well)
      await fs.copyFile(this.dbPath, backupPath);
      
      // Cleanup old backups (keep last 10)
      const backupFiles = await fs.readdir(backupDir);
      const sortedBackups = backupFiles
        .filter(file => file.startsWith('pasteflow-') && file.endsWith('.db'))
        .sort()
        .reverse();
      
      for (const file of sortedBackups.slice(10)) {
        await fs.unlink(path.join(backupDir, file));
      }
      
      this.emit('backupCompleted', {
        backupPath,
        filesRetained: Math.min(sortedBackups.length, 10)
      });
    } catch (error) {
      throw new Error(`Backup failed: ${(error as Error).message}`);
    }
  }

  private async performMaintenance(): Promise<void> {
    if (!this.db) return;

    try {
      const startTime = Date.now();
      
      // Perform WAL checkpoint
      await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      
      // Analyze tables for better query planning
      await this.db.exec('ANALYZE');
      
      // Vacuum if database is large enough
      const pageCount = await this.db.get<{ page_count: number }>('PRAGMA page_count');
      if (pageCount && pageCount.page_count > 10_000) {
        await this.db.exec('VACUUM');
      }
      
      const duration = Date.now() - startTime;
      
      this.emit('maintenanceCompleted', {
        duration,
        operations: ['wal_checkpoint', 'analyze', pageCount && pageCount.page_count > 10_000 ? 'vacuum' : null].filter(Boolean),
        stats: this.db.getStats()
      });
    } catch (error) {
      throw new Error(`Maintenance failed: ${(error as Error).message}`);
    }
  }

  // Workspace operations with proper typing
  async listWorkspaces(): Promise<WorkspaceState[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = await this.db.all<WorkspaceRecord>(`
      SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
      FROM workspaces 
      ORDER BY last_accessed DESC
    `);
    
    return rows.map(row => ({
      ...this.parseWorkspaceState(row.state),
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed
    }));
  }

  async createWorkspace(name: string, folderPath: string, state: WorkspaceState = {}): Promise<WorkspaceState> {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = await this.db.run(`
      INSERT INTO workspaces (name, folder_path, state) 
      VALUES (?, ?, ?)
    `, [name, folderPath, JSON.stringify(state)]);
    
    return this.getWorkspace(result.lastInsertRowid as string);
  }

  async getWorkspace(nameOrId: string): Promise<WorkspaceState> {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = await this.db.get<WorkspaceRecord>(`
      SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
      FROM workspaces 
      WHERE name = ? OR id = ?
    `, [nameOrId, nameOrId]);
    
    if (!row) {
      throw new Error(`Workspace not found: ${nameOrId}`);
    }
    
    return {
      ...this.parseWorkspaceState(row.state),
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed
    };
  }

  async updateWorkspace(name: string, state: WorkspaceState): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    await this.db.run(`
      UPDATE workspaces 
      SET state = ?, updated_at = strftime('%s', 'now') * 1000 
      WHERE name = ?
    `, [JSON.stringify(state), name]);
  }

  async deleteWorkspace(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    await this.db.run('DELETE FROM workspaces WHERE name = ?', [name]);
  }

  async renameWorkspace(oldName: string, newName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    await this.db.transaction(async (db) => {
      // Check if new name already exists
      const existing = await db.get<WorkspaceRecord>(
        'SELECT id FROM workspaces WHERE name = ?',
        [newName]
      );
      
      if (existing) {
        throw new Error(`Workspace '${newName}' already exists`);
      }
      
      // Rename the workspace
      await db.run(`
        UPDATE workspaces 
        SET name = ?, updated_at = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `, [newName, oldName]);
    });
  }

  async touchWorkspace(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    await this.db.run(`
      UPDATE workspaces 
      SET last_accessed = strftime('%s', 'now') * 1000 
      WHERE name = ?
    `, [name]);
  }

  async getWorkspaceNames(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const rows = await this.db.all<{ name: string }>(`
      SELECT name FROM workspaces ORDER BY last_accessed DESC
    `);
    
    return rows.map(row => row.name);
  }

  // Atomic operations
  async updateWorkspaceAtomic(name: string, updates: Partial<WorkspaceState>): Promise<WorkspaceState> {
    if (!this.db) throw new Error('Database not initialized');
    
    return this.db.transaction(async (db) => {
      // Get current workspace
      const current = await this.getWorkspace(name);
      
      // Merge state if provided
      const newState = { ...current, ...updates };
      
      // Update workspace
      await db.run(`
        UPDATE workspaces 
        SET state = ?, updated_at = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `, [JSON.stringify(newState), name]);
      
      // Update last accessed time
      await this.touchWorkspace(name);
      
      return this.getWorkspace(name);
    });
  }

  async renameWorkspaceAtomic(oldName: string, newName: string): Promise<WorkspaceState> {
    if (!this.db) throw new Error('Database not initialized');
    
    return this.db.transaction(async (db) => {
      // Check if new name already exists
      const existing = await db.get<WorkspaceRecord>(
        'SELECT id FROM workspaces WHERE name = ?',
        [newName]
      );
      
      if (existing) {
        throw new Error(`Workspace '${newName}' already exists`);
      }
      
      // Rename the workspace
      await db.run(`
        UPDATE workspaces 
        SET name = ?, updated_at = strftime('%s', 'now') * 1000 
        WHERE name = ?
      `, [newName, oldName]);
      
      // Return the renamed workspace
      return this.getWorkspace(newName);
    });
  }

  // Preferences operations
  async getPreference(key: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const row = await this.db.get<PreferenceRecord>(
      'SELECT value FROM preferences WHERE key = ?',
      [key]
    );
    
    if (!row || !row.value) return null;
    
    // Handle JSON parsing with fallback
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value; // Return as string if not valid JSON
    }
  }

  async setPreference(key: string, value: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    
    await this.db.run(`
      INSERT INTO preferences (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = strftime('%s', 'now') * 1000
    `, [key, serialized]);
  }

  // Utility methods
  private parseWorkspaceState(stateJson: string): WorkspaceState {
    try {
      return stateJson ? JSON.parse(stateJson) : {};
    } catch (error) {
      console.warn('Failed to parse workspace state:', error);
      return {};
    }
  }

  // Performance and monitoring
  getStats() {
    return this.db?.getStats() || null;
  }

  getPerformanceMetrics() {
    return this.db?.getPerformanceMetrics() || null;
  }

  getQueryMetrics() {
    return this.db?.getQueryMetrics() || null;
  }

  getCacheStats() {
    return this.db?.getCacheStats() || null;
  }

  async healthCheck() {
    if (!this.db) {
      return {
        isHealthy: false,
        initialized: false,
        error: 'Database not initialized'
      };
    }
    
    const health = await this.db.healthCheck();
    return {
      ...health,
      initialized: this.initialized,
      dbPath: this.dbPath
    };
  }

  // Cleanup
  async close(): Promise<void> {
    // Stop background tasks
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
    
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    
    // Close database
    if (this.db) {
      await this.db.shutdown();
      this.db = null;
    }
    
    this.initialized = false;
    this.emit('closed');
  }
}