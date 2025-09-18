/* eslint-disable @typescript-eslint/no-var-requires */
import type BetterSqlite3 from 'better-sqlite3';
import { getNodeRequire } from '../node-require';
import { retryTransaction, retryConnection, executeWithRetry } from './retry-utils';
import { toDomainWorkspaceState, fromDomainWorkspaceState } from './mappers';
import type { WorkspaceRecord, PreferenceRecord, InstructionRow } from './types';
import type { PreviewEnvelope, PreviewId, ChatSessionId } from '../agent/preview-registry';
import { assertPreviewEnvelope } from '../agent/preview-registry';
import type { WorkspaceState } from '../../shared-types';
export type { WorkspaceState, Instruction } from '../../shared-types';

// Local require compatible with CJS (tests) and ESM (runtime) builds
const nodeRequire = getNodeRequire();

// Runtime-safe loader to avoid ABI mismatch when not running under Electron
type BetterSqlite3Module = typeof BetterSqlite3;
function loadBetterSqlite3(): BetterSqlite3Module {
  // Ensure we are running under Electron's embedded Node (correct ABI)
  const runningUnderElectron = Boolean(process.versions?.electron);
  const allowNode = process.env.ELECTRON_RUN_AS_NODE === '1' || process.env.PF_ALLOW_NODE_SQLITE === '1';
  if (!runningUnderElectron && !allowNode) {
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


const APPROVAL_STATUS_VALUES = [
  'pending',
  'approved',
  'applied',
  'rejected',
  'auto_approved',
  'failed',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS_VALUES)[number];

export type PreviewRow = Readonly<{
  id: string;
  tool_execution_id: number;
  session_id: string;
  tool: string;
  action: string;
  summary: string;
  detail: string | null;
  args: string | null;
  hash: string;
  created_at: number;
}>;

export type ApprovalRow = Readonly<{
  id: string;
  preview_id: string;
  session_id: string;
  status: ApprovalStatus;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  auto_reason: string | null;
  feedback_text: string | null;
  feedback_meta: string | null;
}>;

const APPROVAL_STATUS_SET: ReadonlySet<ApprovalStatus> = new Set(APPROVAL_STATUS_VALUES);

const AGENT_APPROVAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_tool_previews (
    id TEXT PRIMARY KEY,
    tool_execution_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    args TEXT,
    hash TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_tool_approvals (
    id TEXT PRIMARY KEY,
    preview_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','applied','rejected','auto_approved','failed')),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,
    auto_reason TEXT,
    feedback_text TEXT,
    feedback_meta TEXT,
    FOREIGN KEY(preview_id) REFERENCES agent_tool_previews(id) ON DELETE CASCADE
  );
`;

const AGENT_APPROVAL_INDEX_SQL: readonly { sql: string; operation: string }[] = [
  {
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_previews_session_created ON agent_tool_previews(session_id, created_at DESC);`,
    operation: 'create_agent_preview_session_index',
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_previews_hash ON agent_tool_previews(hash);`,
    operation: 'create_agent_preview_hash_index',
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_approvals_session_status ON agent_tool_approvals(session_id, status);`,
    operation: 'create_agent_approval_session_status_index',
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_approvals_resolved_at ON agent_tool_approvals(resolved_at);`,
    operation: 'create_agent_approval_resolved_at_index',
  },
];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${context} must be a non-empty string`);
  }
  return value;
}

function toNullableString(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`${context} must be a string or null`);
  }
  return value;
}

function toInteger(value: unknown, context: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new TypeError(`${context} must be an integer`);
}

function toNullableInteger(value: unknown, context: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toInteger(value, context);
}

function serializeJson(value: unknown, context: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`Failed to serialize ${context}: ${(error as Error).message}`);
  }
}

function assertApprovalStatus(value: unknown, context: string): asserts value is ApprovalStatus {
  if (typeof value !== 'string' || !APPROVAL_STATUS_SET.has(value as ApprovalStatus)) {
    throw new TypeError(`${context} must be a valid approval status`);
  }
}

function mapPreviewRow(value: unknown, context: string): PreviewRow {
  if (!isObjectRecord(value)) {
    throw new Error(`${context} expected an object for preview row`);
  }

  const normalized: PreviewRow = Object.freeze({
    id: toNonEmptyString(value.id, `${context}.id`),
    tool_execution_id: toInteger(value.tool_execution_id, `${context}.tool_execution_id`),
    session_id: toNonEmptyString(value.session_id, `${context}.session_id`),
    tool: toNonEmptyString(value.tool, `${context}.tool`),
    action: toNonEmptyString(value.action, `${context}.action`),
    summary: toNonEmptyString(value.summary, `${context}.summary`),
    detail: toNullableString(value.detail, `${context}.detail`),
    args: toNullableString(value.args, `${context}.args`),
    hash: toNonEmptyString(value.hash, `${context}.hash`),
    created_at: toInteger(value.created_at, `${context}.created_at`),
  });

  return normalized;
}

function mapApprovalRow(value: unknown, context: string): ApprovalRow {
  if (!isObjectRecord(value)) {
    throw new Error(`${context} expected an object for approval row`);
  }

  const status = toNonEmptyString(value.status, `${context}.status`);
  assertApprovalStatus(status, `${context}.status`);

  const normalized: ApprovalRow = Object.freeze({
    id: toNonEmptyString(value.id, `${context}.id`),
    preview_id: toNonEmptyString(value.preview_id, `${context}.preview_id`),
    session_id: toNonEmptyString(value.session_id, `${context}.session_id`),
    status,
    created_at: toInteger(value.created_at, `${context}.created_at`),
    resolved_at: toNullableInteger(value.resolved_at, `${context}.resolved_at`),
    resolved_by: toNullableString(value.resolved_by, `${context}.resolved_by`),
    auto_reason: toNullableString(value.auto_reason, `${context}.auto_reason`),
    feedback_text: toNullableString(value.feedback_text, `${context}.feedback_text`),
    feedback_meta: toNullableString(value.feedback_meta, `${context}.feedback_meta`),
  });

  return normalized;
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

    await this.ensureAgentApprovalSchema();

    // Optional migration: add latency_ms column to usage_summary if missing
    await executeWithRetry(async () => {
      try {
        const columns = this.db!.prepare("PRAGMA table_info('usage_summary')").all() as { name: string }[];
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
        const columns = this.db!.prepare("PRAGMA table_info('usage_summary')").all() as { name: string }[];
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

  public async ensureAgentApprovalSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not established');
    }

    await executeWithRetry(async () => {
      this.db!.exec(AGENT_APPROVAL_SCHEMA_SQL);
    }, {
      operation: 'ensure_agent_approval_schema',
      maxRetries: 2,
    });

    await this.ensureAgentApprovalIndexes();
  }

  private async ensureAgentApprovalIndexes(): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not established');
    }

    for (const { sql, operation } of AGENT_APPROVAL_INDEX_SQL) {
      try {
        await executeWithRetry(async () => {
          this.db!.exec(sql);
        }, { operation, maxRetries: 1 });
      } catch (error) {
        try {
          console.warn(`[AgentApprovals] Failed to ensure index ${operation}: ${(error as Error).message}`);
        } catch {
          // Logging best-effort; ignore failures
        }
      }
    }
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
  private stmtUpsertChatSession(): BetterSqlite3.Statement<[string, string | null, string | null]> {
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

  private stmtInsertPreview(): BetterSqlite3.Statement<[
    string,
    number,
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    string,
    number,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO agent_tool_previews (id, tool_execution_id, session_id, tool, action, summary, detail, args, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private stmtGetPreviewById(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, tool_execution_id, session_id, tool, action, summary, detail, args, hash, created_at
      FROM agent_tool_previews
      WHERE id = ?
    `);
  }

  private stmtUpdatePreviewDetail(): BetterSqlite3.Statement<[
    string | null,
    string,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      UPDATE agent_tool_previews
      SET detail = ?
      WHERE id = ?
    `);
  }

  private stmtGetApprovalById(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, preview_id, session_id, status, created_at, resolved_at, resolved_by, auto_reason, feedback_text, feedback_meta
      FROM agent_tool_approvals
      WHERE id = ?
    `);
  }

  private stmtListPreviews(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, tool_execution_id, session_id, tool, action, summary, detail, args, hash, created_at
      FROM agent_tool_previews
      WHERE session_id = ?
      ORDER BY created_at DESC
    `);
  }

  private stmtInsertApproval(): BetterSqlite3.Statement<[
    string,
    string,
    string,
    string,
    number,
    number | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      INSERT INTO agent_tool_approvals (id, preview_id, session_id, status, created_at, resolved_at, resolved_by, auto_reason, feedback_text, feedback_meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private stmtUpdateApprovalStatus(): BetterSqlite3.Statement<[
    string,
    number | null,
    string | null,
    string | null,
    string,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      UPDATE agent_tool_approvals
      SET status = ?, resolved_at = ?, resolved_by = ?, auto_reason = ?
      WHERE id = ?
    `);
  }

  private stmtUpdateApprovalFeedback(): BetterSqlite3.Statement<[
    string | null,
    string | null,
    string,
  ]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      UPDATE agent_tool_approvals
      SET feedback_text = ?, feedback_meta = ?
      WHERE id = ?
    `);
  }

  private stmtDeleteResolvedApprovalsBefore(): BetterSqlite3.Statement<[number]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      DELETE FROM agent_tool_approvals
      WHERE resolved_at IS NOT NULL AND resolved_at < ?
    `);
  }

  private stmtDeleteOldPreviewsBefore(): BetterSqlite3.Statement<[number]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      DELETE FROM agent_tool_previews
      WHERE created_at < ?
        AND id NOT IN (
          SELECT preview_id FROM agent_tool_approvals WHERE status = 'pending'
        )
    `);
  }

  private stmtListPendingApprovals(): BetterSqlite3.Statement<[string, string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, preview_id, session_id, status, created_at, resolved_at, resolved_by, auto_reason, feedback_text, feedback_meta
      FROM agent_tool_approvals
      WHERE session_id = ? AND status = ?
      ORDER BY created_at ASC
    `);
  }

  private stmtListApprovalsForExportPreviews(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, tool_execution_id, session_id, tool, action, summary, detail, args, hash, created_at
      FROM agent_tool_previews
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
  }

  private stmtListApprovalsForExportApprovals(): BetterSqlite3.Statement<[string]> {
    if (!this.db) throw new Error('DB not initialized');
    return this.db.prepare(`
      SELECT id, preview_id, session_id, status, created_at, resolved_at, resolved_by, auto_reason, feedback_text, feedback_meta
      FROM agent_tool_approvals
      WHERE session_id = ?
      ORDER BY created_at ASC
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
        serializeJson(entry.args, 'insertToolExecution.args'),
        serializeJson(entry.result, 'insertToolExecution.result'),
        entry.status ?? null,
        entry.error ?? null,
        entry.startedAt ?? null,
        entry.durationMs ?? null,
      );
    }, { operation: 'insert_tool_execution' });
  }

  async insertToolExecutionReturningId(entry: {
    sessionId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    status?: string;
    error?: string | null;
    startedAt?: number | null;
    durationMs?: number | null;
  }): Promise<number> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => {
      const runResult = this.stmtInsertToolExecution().run(
        entry.sessionId,
        entry.toolName,
        serializeJson(entry.args, 'insertToolExecutionReturningId.args'),
        serializeJson(entry.result, 'insertToolExecutionReturningId.result'),
        entry.status ?? null,
        entry.error ?? null,
        entry.startedAt ?? null,
        entry.durationMs ?? null,
      ) as { lastInsertRowid: number | bigint };
      const rawId = runResult.lastInsertRowid;
      const numericId = Number(rawId);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new TypeError('Failed to retrieve inserted tool execution id');
      }
      return numericId;
    }, { operation: 'insert_tool_execution_returning_id' });
    return result as number;
  }

  async listToolExecutions(sessionId: string): Promise<{
    id: number; session_id: string; tool_name: string; args: string | null; result: string | null; status: string | null; error: string | null; started_at: number | null; duration_ms: number | null; created_at: number;
  }[]> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => this.stmtListToolExecutions().all(sessionId) as unknown[], { operation: 'list_tool_executions' });
    return (result ?? []) as {
      id: number; session_id: string; tool_name: string; args: string | null; result: string | null; status: string | null; error: string | null; started_at: number | null; duration_ms: number | null; created_at: number;
    }[];
  }

  async insertPreview(preview: PreviewEnvelope & { toolExecutionId: number }): Promise<void> {
    this.ensureInitialized();
    assertPreviewEnvelope(preview);
    if (!Number.isInteger(preview.toolExecutionId) || preview.toolExecutionId <= 0) {
      throw new Error('preview.toolExecutionId must be a positive integer');
    }

    await executeWithRetry(async () => {
      this.stmtInsertPreview().run(
        preview.id,
        preview.toolExecutionId,
        preview.sessionId,
        preview.tool,
        preview.action,
        preview.summary,
        serializeJson(preview.detail, 'insertPreview.detail'),
        serializeJson(preview.originalArgs, 'insertPreview.originalArgs'),
        preview.hash,
        preview.createdAt,
      );
    }, { operation: 'insert_agent_tool_preview' });
  }

  async getPreviewById(id: PreviewId): Promise<PreviewRow | null> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => {
      const row = this.stmtGetPreviewById().get(id) as unknown;
      return row ?? null;
    }, { operation: 'get_agent_tool_preview' });

    if (!result) {
      return null;
    }

    return mapPreviewRow(result, `getPreviewById(${id})`);
  }

  async getApprovalById(id: string): Promise<ApprovalRow | null> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => {
      const row = this.stmtGetApprovalById().get(id) as unknown;
      return row ?? null;
    }, { operation: 'get_agent_tool_approval' });

    if (!result) {
      return null;
    }

    return mapApprovalRow(result, `getApprovalById(${id})`);
  }

  async listPreviews(sessionId: ChatSessionId): Promise<readonly PreviewRow[]> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => this.stmtListPreviews().all(sessionId) as unknown, { operation: 'list_agent_tool_previews' });
    const rows = Array.isArray(result) ? result : [];
    const mapped = rows.map((row, index) => mapPreviewRow(row, `listPreviews[${index}]`));
    return Object.freeze(mapped) as readonly PreviewRow[];
  }

  async insertApproval(input: {
    id: string;
    previewId: string;
    sessionId: string;
    status: ApprovalStatus;
    createdAt: number;
    resolvedAt?: number | null;
    resolvedBy?: string | null;
    autoReason?: string | null;
    feedbackText?: string | null;
    feedbackMeta?: unknown | null;
  }): Promise<void> {
    this.ensureInitialized();

    const { id, previewId, sessionId, status, createdAt } = input;
    if (!id || !previewId || !sessionId) {
      throw new Error('insertApproval requires non-empty id, previewId, and sessionId');
    }
    if (!Number.isInteger(createdAt) || createdAt < 0) {
      throw new Error('insertApproval.createdAt must be a non-negative integer');
    }
    assertApprovalStatus(status, 'insertApproval.status');

    const resolvedAt = input.resolvedAt ?? null;
    if (resolvedAt !== null && (!Number.isInteger(resolvedAt) || resolvedAt < 0)) {
      throw new Error('insertApproval.resolvedAt must be a non-negative integer when provided');
    }

    const feedbackMeta = serializeJson(input.feedbackMeta ?? null, 'insertApproval.feedbackMeta');

    await executeWithRetry(async () => {
      this.stmtInsertApproval().run(
        id,
        previewId,
        sessionId,
        status,
        createdAt,
        resolvedAt,
        input.resolvedBy ?? null,
        input.autoReason ?? null,
        input.feedbackText ?? null,
        feedbackMeta,
      );
    }, { operation: 'insert_agent_tool_approval' });
  }

  async updateApprovalStatus(input: {
    id: string;
    status: ApprovalStatus;
    resolvedAt?: number | null;
    resolvedBy?: string | null;
    autoReason?: string | null;
  }): Promise<void> {
    this.ensureInitialized();

    if (!input.id) {
      throw new Error('updateApprovalStatus requires id');
    }
    assertApprovalStatus(input.status, 'updateApprovalStatus.status');

    const resolvedAt = input.resolvedAt ?? null;
    if (resolvedAt !== null && (!Number.isInteger(resolvedAt) || resolvedAt < 0)) {
      throw new Error('updateApprovalStatus.resolvedAt must be a non-negative integer when provided');
    }

    await executeWithRetry(async () => {
      this.stmtUpdateApprovalStatus().run(
        input.status,
        resolvedAt,
        input.resolvedBy ?? null,
        input.autoReason ?? null,
        input.id,
      );
    }, { operation: 'update_agent_tool_approval_status' });
  }

  async updateApprovalFeedback(input: { id: string; feedbackText?: string | null; feedbackMeta?: unknown | null }): Promise<void> {
    this.ensureInitialized();
    if (!input.id) {
      throw new Error('updateApprovalFeedback requires id');
    }
    const feedbackMeta = serializeJson(input.feedbackMeta ?? null, 'updateApprovalFeedback.feedbackMeta');

    await executeWithRetry(async () => {
      this.stmtUpdateApprovalFeedback().run(
        input.feedbackText ?? null,
        feedbackMeta,
        input.id,
      );
    }, { operation: 'update_agent_tool_approval_feedback' });
  }

  async updatePreviewDetail(input: { id: PreviewId; patch: Readonly<Record<string, unknown>> }): Promise<void> {
    this.ensureInitialized();
    if (!input.id) {
      throw new Error('updatePreviewDetail requires id');
    }

    const existing = await this.getPreviewById(input.id);
    if (!existing) {
      throw new Error('Preview not found');
    }

    let currentDetail: Record<string, unknown> = {};
    if (existing.detail) {
      try {
        const parsed = JSON.parse(existing.detail);
        if (isObjectRecord(parsed)) {
          currentDetail = { ...parsed };
        }
      } catch (error) {
        console.warn('[AgentApprovals] Failed to parse existing preview detail during update', error);
      }
    }

    const mergedDetail = { ...currentDetail, ...input.patch };
    const serializedDetail = serializeJson(mergedDetail, 'updatePreviewDetail.detail');

    await executeWithRetry(async () => {
      this.stmtUpdatePreviewDetail().run(
        serializedDetail,
        input.id,
      );
    }, { operation: 'update_agent_tool_preview_detail' });
  }

  async pruneApprovals(olderThanTs: number): Promise<{ previews: number; approvals: number }> {
    this.ensureInitialized();
    if (!Number.isInteger(olderThanTs) || olderThanTs < 0) {
      throw new Error('pruneApprovals requires a non-negative integer timestamp');
    }

    const approvalsResult = await executeWithRetry(async () => this.stmtDeleteResolvedApprovalsBefore().run(olderThanTs), {
      operation: 'prune_agent_tool_approvals_resolved',
    });

    const previewsResult = await executeWithRetry(async () => this.stmtDeleteOldPreviewsBefore().run(olderThanTs), {
      operation: 'prune_agent_tool_previews',
    });

    const approvals = typeof approvalsResult.result?.changes === 'number' ? approvalsResult.result.changes : 0;
    const previews = typeof previewsResult.result?.changes === 'number' ? previewsResult.result.changes : 0;

    return { approvals, previews };
  }

  async listPendingApprovals(sessionId: ChatSessionId): Promise<readonly ApprovalRow[]> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => this.stmtListPendingApprovals().all(sessionId, 'pending') as unknown, { operation: 'list_pending_agent_approvals' });
    const rows = Array.isArray(result) ? result : [];
    const mapped = rows.map((row, index) => mapApprovalRow(row, `listPendingApprovals[${index}]`));
    return Object.freeze(mapped) as readonly ApprovalRow[];
  }

  async listApprovalsForExport(sessionId: ChatSessionId): Promise<{ previews: readonly PreviewRow[]; approvals: readonly ApprovalRow[] }> {
    this.ensureInitialized();

    const { result: previewResult } = await executeWithRetry(async () => this.stmtListApprovalsForExportPreviews().all(sessionId) as unknown, { operation: 'list_agent_previews_for_export' });
    const { result: approvalResult } = await executeWithRetry(async () => this.stmtListApprovalsForExportApprovals().all(sessionId) as unknown, { operation: 'list_agent_approvals_for_export' });

    const previewsArray = Array.isArray(previewResult) ? previewResult : [];
    const approvalsArray = Array.isArray(approvalResult) ? approvalResult : [];

    const previews = Object.freeze(previewsArray.map((row, index) => mapPreviewRow(row, `listApprovalsForExport.previews[${index}]`))) as readonly PreviewRow[];
    const approvals = Object.freeze(approvalsArray.map((row, index) => mapApprovalRow(row, `listApprovalsForExport.approvals[${index}]`))) as readonly ApprovalRow[];

    return Object.freeze({ previews, approvals });
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

  async listUsageSummaries(sessionId: string): Promise<{ id: number; session_id: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; created_at: number }[]> {
    this.ensureInitialized();
    const { result } = await executeWithRetry(async () => this.stmtListUsageSummaries().all(sessionId) as unknown[], { operation: 'list_usage_summaries' });
    return (result ?? []) as { id: number; session_id: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; created_at: number }[];
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
