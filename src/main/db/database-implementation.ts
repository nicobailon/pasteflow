/* eslint-disable @typescript-eslint/no-var-requires */
import type BetterSqlite3 from 'better-sqlite3';
import { createRequire } from 'node:module';

// Local require compatible with CJS and ESM builds
const nodeRequire: NodeJS.Require = (typeof module !== 'undefined' && (module as any).require)
  ? (module as any).require.bind(module)
  : createRequire(import.meta.url);

import { retryTransaction, retryConnection, executeWithRetry } from './retry-utils';
import type { WorkspaceState, Instruction } from '../../shared-types';
import type { WorkspaceRecord, PreferenceRecord, InstructionRow } from './types';
import { toDomainWorkspaceState, fromDomainWorkspaceState } from './mappers';

// Re-export for existing consumers
export type { WorkspaceState, Instruction };

// Runtime-safe loader to avoid ABI mismatch when not running under Electron
type BetterSqlite3Module = typeof BetterSqlite3;
function loadBetterSqlite3(): BetterSqlite3Module {
  // Ensure we are running under Electron's embedded Node (correct ABI)
  if (!process.versions?.electron) {
    throw new Error('better-sqlite3 must be loaded from Electron main process. Launch via Electron (npm start / dev:electron), not plain node.');
  }
   
  return nodeRequire('better-sqlite3') as BetterSqlite3Module;
}

// Define SQLite error type with proper constraints
interface SQLiteError extends Error {
  code?: 'SQLITE_BUSY' | 'SQLITE_LOCKED' | 'SQLITE_CORRUPT' | 'SQLITE_CANTOPEN' | 
         'SQLITE_READONLY' | 'SQLITE_IOERR' | 'SQLITE_FULL' | 'SQLITE_CONSTRAINT' | 
         'SQLITE_NOTADB' | 'SQLITE_PROTOCOL' | string;
  errno?: number;
  syscall?: string;
}


// Define precise types for preferences
export type PreferenceValue = string | number | boolean | null | {
  [key: string]: PreferenceValue;
} | PreferenceValue[];

// Parsed workspace with deserialized state
export interface ParsedWorkspace {
  id: number;
  name: string;
  folder_path: string;
  state: WorkspaceState;
  created_at: number;
  updated_at: number;
  last_accessed: number;
}


interface PreparedStatements {
  listWorkspaces: BetterSqlite3.Statement<[]>;
  getWorkspace: BetterSqlite3.Statement<[string, string]>;
  createWorkspace: BetterSqlite3.Statement<[string, string, string]>;
  updateWorkspace: BetterSqlite3.Statement<[string, string]>;
  updateWorkspaceById: BetterSqlite3.Statement<[string, string]>;
  deleteWorkspace: BetterSqlite3.Statement<[string]>;
  deleteWorkspaceById: BetterSqlite3.Statement<[string, string]>;
  renameWorkspace: BetterSqlite3.Statement<[string, string]>;
  touchWorkspace: BetterSqlite3.Statement<[string]>;
  getWorkspaceNames: BetterSqlite3.Statement<[]>;
  getPreference: BetterSqlite3.Statement<[string]>;
  setPreference: BetterSqlite3.Statement<[string, string]>;
  listInstructions: BetterSqlite3.Statement<[]>;
  createInstruction: BetterSqlite3.Statement<[string, string, string]>;
  updateInstruction: BetterSqlite3.Statement<[string, string, string]>;
  deleteInstruction: BetterSqlite3.Statement<[string]>;
}

/**
 * SQLite database implementation for PasteFlow workspace and preference management.
 * Provides optimized performance with WAL mode, prepared statements, and indexes.
 * All timestamps are stored as Unix milliseconds for consistency across platforms.
 */
export class PasteFlowDatabase {
  private dbPath: string;
  public db: BetterSqlite3.Database | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private statements!: PreparedStatements;

  /**
   * Creates a new PasteFlowDatabase instance and initializes the schema with retry support.
   * 
   * @param dbPath - Path to the SQLite database file (use ':memory:' for in-memory)
   * @throws {Error} If database cannot be created or schema setup fails
   * @example
   * const db = new PasteFlowDatabase('/path/to/pasteflow.db');
   * // or for testing
   * const testDb = new PasteFlowDatabase(':memory:');
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initializeDatabase(): Promise<void> {
    // Return existing promise if initialization is already in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // Store the promise to prevent concurrent initialization
    this.initializationPromise = this._performInitialization();
    return this.initializationPromise;
  }

  private async _performInitialization(): Promise<void> {
    try {
      this.db = await retryConnection(async () => {
        const BetterSqlite = loadBetterSqlite3();
        const db = new BetterSqlite(this.dbPath);
        // Test connection with a simple query
        db.prepare('SELECT 1').get();
        return db;
      });
      
      await this.setupDatabase();
      this.isInitialized = true;
      console.log('Database initialized successfully with retry support');
    } catch (error) {
      console.error('Failed to initialize database after all retries:', error);
      
      // Provide more granular error information based on SQLite error codes
      const sqliteError = error as SQLiteError;
      if (sqliteError.code) {
        switch (sqliteError.code) {
          case 'SQLITE_BUSY': {
            throw new Error(`Database is locked by another process: ${sqliteError.message}`);
          }
          case 'SQLITE_LOCKED': {
            throw new Error(`Database table is locked: ${sqliteError.message}`);
          }
          case 'SQLITE_CORRUPT': {
            throw new Error(`Database file is corrupted: ${sqliteError.message}`);
          }
          case 'SQLITE_CANTOPEN': {
            throw new Error(`Cannot open database file at ${this.dbPath}: ${sqliteError.message}`);
          }
          case 'SQLITE_READONLY': {
            throw new Error(`Database is read-only: ${sqliteError.message}`);
          }
          case 'SQLITE_IOERR': {
            throw new Error(`Database I/O error: ${sqliteError.message}`);
          }
          case 'SQLITE_FULL': {
            throw new Error(`Disk is full or database quota exceeded: ${sqliteError.message}`);
          }
          default: {
            throw new Error(`Database initialization failed (${sqliteError.code}): ${sqliteError.message}`);
          }
        }
      }
      
      // For non-SQLite errors or errors without codes
      throw new Error(`Database initialization failed: ${(error as Error).message}`);
    }
  }

  private ensureInitialized(): void {
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
  private async setupDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not established');
    }

    // Enable performance optimizations with retry
    await executeWithRetry(async () => {
      this.db!.pragma('journal_mode = WAL');
      this.db!.pragma('synchronous = NORMAL');
      this.db!.pragma('cache_size = -64000'); // 64MB cache
      this.db!.pragma('temp_store = MEMORY');
    }, {
      operation: 'setup_database_pragmas',
      maxRetries: 3
    });

    // Create tables if they don't exist with retry
    await executeWithRetry(async () => {
      this.db!.exec(`
        DROP INDEX IF EXISTS idx_prompts_name;
        DROP TABLE IF EXISTS custom_prompts;

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


        CREATE TABLE IF NOT EXISTS instructions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );

        -- Phase 4: Durable agent chat sessions and telemetry
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          messages TEXT NOT NULL, -- JSON array of messages (capped)
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );

        CREATE TABLE IF NOT EXISTS tool_executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          args TEXT,
          result TEXT,
          status TEXT,
          error TEXT,
          started_at INTEGER,
          duration_ms INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );

        CREATE TABLE IF NOT EXISTS usage_summary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          total_tokens INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);
        CREATE INDEX IF NOT EXISTS idx_workspaces_last_accessed ON workspaces(last_accessed DESC);
        CREATE INDEX IF NOT EXISTS idx_workspaces_folder_path ON workspaces(folder_path);
        CREATE INDEX IF NOT EXISTS idx_preferences_key ON preferences(key);
        CREATE INDEX IF NOT EXISTS idx_preferences_updated_at ON preferences(updated_at);
        CREATE INDEX IF NOT EXISTS idx_instructions_name ON instructions(name);
        CREATE INDEX IF NOT EXISTS idx_instructions_updated_at ON instructions(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_executions_started ON tool_executions(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_usage_summary_session ON usage_summary(session_id);
        CREATE INDEX IF NOT EXISTS idx_usage_summary_created ON usage_summary(created_at DESC);
      `);
    }, {
      operation: 'create_database_schema',
      maxRetries: 3
    });

    // Optional migration: add latency_ms column to usage_summary if missing
    await executeWithRetry(async () => {
      try {
        const columns = this.db!.prepare("PRAGMA table_info('usage_summary')").all() as Array<{ name: string }>; 
        const hasLatency = Array.isArray(columns) && columns.some((c) => String(c.name).toLowerCase() === 'latency_ms');
        if (!hasLatency) {
          this.db!.exec("ALTER TABLE usage_summary ADD COLUMN latency_ms INTEGER");
        }
      } catch {
        // ignore migration errors to avoid blocking startup
      }
    }, { operation: 'migrate_usage_summary_latency_ms', maxRetries: 1 });

    // Optional migration: add cost_usd column to usage_summary if missing
    await executeWithRetry(async () => {
      try {
        const columns = this.db!.prepare("PRAGMA table_info('usage_summary')").all() as Array<{ name: string }>;
        const hasCost = Array.isArray(columns) && columns.some((c) => String(c.name).toLowerCase() === 'cost_usd');
        if (!hasCost) {
          this.db!.exec("ALTER TABLE usage_summary ADD COLUMN cost_usd REAL");
        }
      } catch {
        // ignore migration errors
      }
    }, { operation: 'migrate_usage_summary_cost_usd', maxRetries: 1 });

    // Prepare statements with retry
    await this.prepareStatements();
  }

  private async prepareStatements(): Promise<void> {
    await executeWithRetry(async () => {
      this.statements = {
        // Workspace operations
        listWorkspaces: this.db!.prepare(`
          SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
          FROM workspaces 
          ORDER BY last_accessed DESC
        `),
        
        getWorkspace: this.db!.prepare(`
          SELECT id, name, folder_path, state, created_at, updated_at, last_accessed 
          FROM workspaces 
          WHERE name = ? OR id = ?
        `),
        
        createWorkspace: this.db!.prepare(`
          INSERT INTO workspaces (name, folder_path, state) 
          VALUES (?, ?, ?)
        `),
        
        updateWorkspace: this.db!.prepare(`
          UPDATE workspaces
          SET state = ?, updated_at = strftime('%s', 'now') * 1000
          WHERE name = ?
        `),

        updateWorkspaceById: this.db!.prepare(`
          UPDATE workspaces
          SET state = ?, updated_at = strftime('%s', 'now') * 1000
          WHERE id = ?
        `),
        
        deleteWorkspace: this.db!.prepare(`
          DELETE FROM workspaces WHERE name = ?
        `),
        
        deleteWorkspaceById: this.db!.prepare(`
          DELETE FROM workspaces WHERE id = ? OR name = ?
        `),
        
        renameWorkspace: this.db!.prepare(`
          UPDATE workspaces 
          SET name = ?, updated_at = strftime('%s', 'now') * 1000 
          WHERE name = ?
        `),
        
        touchWorkspace: this.db!.prepare(`
          UPDATE workspaces 
          SET last_accessed = strftime('%s', 'now') * 1000 
          WHERE name = ?
        `),
        
        getWorkspaceNames: this.db!.prepare(`
          SELECT name FROM workspaces ORDER BY last_accessed DESC
        `),
        
        // Preference operations
        getPreference: this.db!.prepare(`
          SELECT value FROM preferences WHERE key = ?
        `),
        
        setPreference: this.db!.prepare(`
          INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)
        `),
        
        // Instructions operations
        listInstructions: this.db!.prepare(`
          SELECT id, name, content, created_at, updated_at 
          FROM instructions 
          ORDER BY updated_at DESC
        `),
        
        createInstruction: this.db!.prepare(`
          INSERT INTO instructions (id, name, content) VALUES (?, ?, ?)
        `),
        
        updateInstruction: this.db!.prepare(`
          UPDATE instructions 
          SET name = ?, content = ?, updated_at = strftime('%s', 'now') * 1000 
          WHERE id = ?
        `),
        
        deleteInstruction: this.db!.prepare(`
          DELETE FROM instructions WHERE id = ?
        `),
      };
    }, {
      operation: 'prepare_statements',
      maxRetries: 3
    });
  }

  // Phase 4 prepared statements and helpers (inline for simplicity)
  private stmtUpsertChatSession(): BetterSqlite3.Statement<[string, string, string | null]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO chat_sessions (id, workspace_id, messages)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        messages = excluded.messages,
        updated_at = strftime('%s', 'now') * 1000
    `);
  }

  private stmtGetChatSession(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`SELECT id, workspace_id, messages, created_at, updated_at FROM chat_sessions WHERE id = ?`);
  }

  private stmtInsertToolExecution(): BetterSqlite3.Statement<[string, string, string | null, string | null, string | null, string | null, number | null, number | null]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO tool_executions (session_id, tool_name, args, result, status, error, started_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private stmtListToolExecutions(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, session_id, tool_name, args, result, status, error, started_at, duration_ms, created_at
      FROM tool_executions WHERE session_id = ? ORDER BY created_at ASC
    `);
  }

  private stmtInsertUsageSummary(): BetterSqlite3.Statement<[string, number | null, number | null, number | null]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO usage_summary (session_id, input_tokens, output_tokens, total_tokens)
      VALUES (?, ?, ?, ?)
    `);
  }

  // Insert that includes latency (nullable)
  private stmtInsertUsageSummaryWithLatency(): BetterSqlite3.Statement<[
    string,
    number | null,
    number | null,
    number | null,
    number | null,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO usage_summary (session_id, input_tokens, output_tokens, total_tokens, latency_ms)
      VALUES (?, ?, ?, ?, ?)
    `);
  }

  private stmtListUsageSummaries(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, session_id, input_tokens, output_tokens, total_tokens, latency_ms, cost_usd, created_at
      FROM usage_summary WHERE session_id = ? ORDER BY created_at ASC
    `);
  }

  private stmtPruneToolExecutions(): BetterSqlite3.Statement<[number]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`DELETE FROM tool_executions WHERE created_at < ?`);
  }

  private stmtPruneUsageSummary(): BetterSqlite3.Statement<[number]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`DELETE FROM usage_summary WHERE created_at < ?`);
  }

  // Workspace operations
  async listWorkspaces(): Promise<ParsedWorkspace[]> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const rows = this.statements.listWorkspaces.all() as WorkspaceRecord[];
      return rows.map(row => ({
        ...row,
        state: toDomainWorkspaceState(row),
      }));
    }, {
      operation: 'list_workspaces'
    });
    return result.result as ParsedWorkspace[];
  }

  async createWorkspace(name: string, folderPath: string, state: Partial<WorkspaceState> = {}): Promise<ParsedWorkspace> {
    this.ensureInitialized();
    return await retryTransaction(async () => {
      // Merge with defaults to ensure full WorkspaceState
      const fullState: WorkspaceState = {
        selectedFolder: null,
        selectedFiles: [],
        expandedNodes: {},
        sortOrder: 'name',
        searchTerm: '',
        fileTreeMode: 'selected-with-roots',
        exclusionPatterns: [],
        userInstructions: '',
        tokenCounts: {},
        systemPrompts: [],
        rolePrompts: [],
        ...state
      };
      const stateJson = fromDomainWorkspaceState(fullState);
      this.statements.createWorkspace.run(name, folderPath, stateJson);
      const workspace = this.statements.getWorkspace.get(name, name) as WorkspaceRecord;
      return {
        ...workspace,
        state: fullState
      };
    });
  }

  async getWorkspace(nameOrId: string | number): Promise<ParsedWorkspace | null> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const id = String(nameOrId);
      const row = this.statements.getWorkspace.get(id, id) as WorkspaceRecord | undefined;
      if (!row) return null;
      const parsedState = toDomainWorkspaceState(row);
      return {
        ...row,
        state: parsedState
      };
    }, {
      operation: 'get_workspace'
    });
    return result.result as ParsedWorkspace | null;
  }

  async updateWorkspace(name: string, state: Partial<WorkspaceState>): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      const stateJson = fromDomainWorkspaceState(state as WorkspaceState);
      this.statements.updateWorkspace.run(stateJson, name);
    }, {
      operation: 'update_workspace'
    });
  }

  async updateWorkspaceById(id: number, state: Partial<WorkspaceState>): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      const stateJson = fromDomainWorkspaceState(state as WorkspaceState);
      const result = this.statements.updateWorkspaceById.run(stateJson, String(id));
      if ((result as any).changes === 0) {
        throw new Error(`Workspace with id '${id}' not found`);
      }
    }, {
      operation: 'update_workspace_by_id'
    });
  }

  async deleteWorkspace(name: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.statements.deleteWorkspace.run(name);
    }, {
      operation: 'delete_workspace'
    });
  }

  async deleteWorkspaceById(id: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.statements.deleteWorkspaceById.run(id, id);
    }, {
      operation: 'delete_workspace_by_id'
    });
  }

  async renameWorkspace(oldName: string, newName: string): Promise<void> {
    this.ensureInitialized();
    await retryTransaction(async () => {
      // Check if new name already exists
      const existing = this.statements.getWorkspace.get(newName, newName);
      if (existing) {
        throw new Error(`Workspace with name '${newName}' already exists`);
      }
      
      // Perform rename
      const result = this.statements.renameWorkspace.run(newName, oldName);
      if (result.changes === 0) {
        throw new Error(`Workspace '${oldName}' not found`);
      }
    });
  }

  async touchWorkspace(name: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      const result = this.statements.touchWorkspace.run(name);
      if (result.changes === 0) {
        throw new Error(`Workspace '${name}' not found`);
      }
    }, {
      operation: 'touch_workspace'
    });
  }

  async getWorkspaceNames(): Promise<string[]> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const rows = this.statements.getWorkspaceNames.all() as { name: string }[];
      return rows.map(row => row.name);
    }, {
      operation: 'get_workspace_names'
    });
    return result.result as string[];
  }

  // Phase 4: Sessions & telemetry
  async upsertChatSession(sessionId: string, messagesJson: string, workspaceId: string | null = null): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.stmtUpsertChatSession().run(sessionId, workspaceId, messagesJson);
    }, { operation: 'upsert_chat_session' });
  }

  async getChatSession(sessionId: string): Promise<{ id: string; workspace_id: string | null; messages: string; created_at: number; updated_at: number } | null> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const row = this.stmtGetChatSession().get(sessionId) as any | undefined;
      return row ?? null;
    }, { operation: 'get_chat_session' });
    return result.result as any;
  }

  async insertToolExecution(entry: {
    sessionId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    status?: string;
    error?: string | null;
    startedAt?: number | null;
    durationMs?: number | null;
  }): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.stmtInsertToolExecution().run(
        entry.sessionId,
        entry.toolName,
        entry.args === undefined ? null : JSON.stringify(entry.args),
        entry.result === undefined ? null : JSON.stringify(entry.result),
        entry.status ?? null,
        entry.error ?? null,
        entry.startedAt ?? null,
        entry.durationMs ?? null,
      );
    }, { operation: 'insert_tool_execution' });
  }

  async listToolExecutions(sessionId: string): Promise<Array<{
    id: number; session_id: string; tool_name: string; args: string | null; result: string | null; status: string | null; error: string | null; started_at: number | null; duration_ms: number | null; created_at: number;
  }>> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const rows = this.stmtListToolExecutions().all(sessionId) as any[];
      return rows;
    }, { operation: 'list_tool_executions' });
    return result.result as any[];
  }

  async insertUsageSummary(sessionId: string, inputTokens: number | null, outputTokens: number | null, totalTokens: number | null): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.stmtInsertUsageSummary().run(sessionId, inputTokens ?? null, outputTokens ?? null, totalTokens ?? null);
    }, { operation: 'insert_usage_summary' });
  }

  async insertUsageSummaryWithLatency(sessionId: string, inputTokens: number | null, outputTokens: number | null, totalTokens: number | null, latencyMs: number | null): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      try {
        this.stmtInsertUsageSummaryWithLatency().run(
          sessionId,
          inputTokens ?? null,
          outputTokens ?? null,
          totalTokens ?? null,
          latencyMs ?? null,
        );
      } catch {
        // Fallback to legacy insert if statement fails (e.g., column missing)
        this.stmtInsertUsageSummary().run(sessionId, inputTokens ?? null, outputTokens ?? null, totalTokens ?? null);
      }
    }, { operation: 'insert_usage_summary_with_latency' });
  }

  async insertUsageSummaryWithLatencyAndCost(sessionId: string, inputTokens: number | null, outputTokens: number | null, totalTokens: number | null, latencyMs: number | null, costUsd: number | null): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      try {
        // Ensure statement exists; prepare dynamically to guard against older DBs
        const stmt = this.db!.prepare(`
          INSERT INTO usage_summary (session_id, input_tokens, output_tokens, total_tokens, latency_ms, cost_usd)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(sessionId, inputTokens ?? null, outputTokens ?? null, totalTokens ?? null, latencyMs ?? null, (typeof costUsd === 'number' && Number.isFinite(costUsd)) ? costUsd : null);
      } catch {
        try {
          this.stmtInsertUsageSummaryWithLatency().run(sessionId, inputTokens ?? null, outputTokens ?? null, totalTokens ?? null, latencyMs ?? null);
        } catch {
          this.stmtInsertUsageSummary().run(sessionId, inputTokens ?? null, outputTokens ?? null, totalTokens ?? null);
        }
      }
    }, { operation: 'insert_usage_summary_with_latency_and_cost' });
  }

  async listUsageSummaries(sessionId: string): Promise<Array<{ id: number; session_id: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; created_at: number }>> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const rows = this.stmtListUsageSummaries().all(sessionId) as any[];
      return rows;
    }, { operation: 'list_usage_summaries' });
    return result.result as any[];
  }

  async pruneToolExecutions(olderThanTs: number): Promise<number> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const r = this.stmtPruneToolExecutions().run(olderThanTs);
      return r.changes || 0;
    }, { operation: 'prune_tool_executions' });
    return (result.result as number) ?? 0;
  }

  async pruneUsageSummary(olderThanTs: number): Promise<number> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const r = this.stmtPruneUsageSummary().run(olderThanTs);
      return r.changes || 0;
    }, { operation: 'prune_usage_summary' });
    return (result.result as number) ?? 0;
  }

  // Atomic operations
  async updateWorkspaceAtomic(name: string, updates: { state?: Partial<WorkspaceState>; folderPath?: string }): Promise<ParsedWorkspace> {
    this.ensureInitialized();
    return await retryTransaction(async () => {
      const workspace = await this.getWorkspace(name);
      if (!workspace) {
        throw new Error(`Workspace '${name}' not found`);
      }
      
      const newState = updates.state === undefined 
        ? workspace.state
        : { ...workspace.state, ...updates.state };
      
      if (updates.folderPath) {
        this.db!.prepare(`
          UPDATE workspaces 
          SET state = ?, folder_path = ?, updated_at = strftime('%s', 'now') * 1000 
          WHERE name = ?
        `).run(fromDomainWorkspaceState(newState), updates.folderPath, name);
      } else {
        await this.updateWorkspace(name, newState);
      }
      
      const result = await this.getWorkspace(name);
      return result!;
    });
  }

  async renameWorkspaceAtomic(oldName: string, newName: string): Promise<ParsedWorkspace> {
    this.ensureInitialized();
    return await retryTransaction(async () => {
      const workspace = await this.getWorkspace(oldName);
      if (!workspace) {
        throw new Error(`Workspace '${oldName}' not found`);
      }
      
      const existing = await this.getWorkspace(newName);
      if (existing) {
        throw new Error(`Workspace '${newName}' already exists`);
      }
      
      await this.renameWorkspace(oldName, newName);
      const result = await this.getWorkspace(newName);
      return result!;
    });
  }

  // Preference operations
  async getPreference(key: string): Promise<PreferenceValue> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      const row = this.statements.getPreference.get(key) as PreferenceRecord | undefined;
      if (!row || !row.value) return null;
      
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    }, {
      operation: 'get_preference'
    });
    return result.result as PreferenceValue;
  }

  async setPreference(key: string, value: PreferenceValue): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      const valueJson = value === null || value === undefined 
        ? null 
        : (typeof value === 'string' ? value : JSON.stringify(value));
      this.statements.setPreference.run(key, valueJson as string);
    }, {
      operation: 'set_preference'
    });
  }

  // Instructions operations
  async listInstructions(): Promise<InstructionRow[]> {
    this.ensureInitialized();
    const result = await executeWithRetry(async () => {
      return this.statements.listInstructions.all() as InstructionRow[];
    }, {
      operation: 'list_instructions'
    });
    return result.result as InstructionRow[];
  }

  async createInstruction(id: string, name: string, content: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.statements.createInstruction.run(id, name, content);
    }, {
      operation: 'create_instruction'
    });
  }

  async updateInstruction(id: string, name: string, content: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.statements.updateInstruction.run(name, content, id);
    }, {
      operation: 'update_instruction'
    });
  }

  async deleteInstruction(id: string): Promise<void> {
    this.ensureInitialized();
    await executeWithRetry(async () => {
      this.statements.deleteInstruction.run(id);
    }, {
      operation: 'delete_instruction'
    });
  }

  // Cleanup
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}
