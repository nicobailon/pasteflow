import type BetterSqlite3 from 'better-sqlite3';

export type LogCategory = 'api' | 'preview';

export interface LogEntry {
  id: string;
  ts: number;
  category: LogCategory;
  action: string;
  status: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface LogEntryInput {
  id?: string;
  ts?: number;
  category: LogCategory;
  action: string;
  status: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface LogListOptions {
  limit?: number;
  category?: LogCategory;
}

export class DatabaseLogs {
  private insertStmt!: BetterSqlite3.Statement;
  private listAllStmt!: BetterSqlite3.Statement;
  private listByCatStmt!: BetterSqlite3.Statement;
  private pruneStmt!: BetterSqlite3.Statement;

  constructor(private readonly db: BetterSqlite3.Database) {
    this.ensureSchema();
    this.prepareStatements();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cli_logs(
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cli_logs_ts ON cli_logs(ts DESC);
    `);
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO cli_logs (id, ts, category, action, status, duration_ms, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.listAllStmt = this.db.prepare(`
      SELECT id, ts, category, action, status, duration_ms as durationMs, details
      FROM cli_logs
      ORDER BY ts DESC
      LIMIT ?
    `);
    this.listByCatStmt = this.db.prepare(`
      SELECT id, ts, category, action, status, duration_ms as durationMs, details
      FROM cli_logs
      WHERE category = ?
      ORDER BY ts DESC
      LIMIT ?
    `);
    this.pruneStmt = this.db.prepare(`
      DELETE FROM cli_logs WHERE ts < ?
    `);
  }

  insertLog(entry: LogEntryInput): void {
    const id = entry.id ?? cryptoRandomId();
    const ts = entry.ts ?? Date.now();
    const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
    this.insertStmt.run(id, ts, entry.category, entry.action, entry.status, entry.durationMs ?? null, detailsJson);
  }

  listLogs(opts: LogListOptions = {}): LogEntry[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
    const baseRows = opts.category
      ? (this.listByCatStmt.all(opts.category, limit) as unknown[])
      : (this.listAllStmt.all(limit) as unknown[]);

    const rows = baseRows as {
      id: string;
      ts: number;
      category: string;
      action: string;
      status: string;
      durationMs?: number | null;
      details?: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      category: r.category as LogCategory,
      action: r.action,
      status: r.status,
      durationMs: r.durationMs === null || r.durationMs === undefined ? undefined : Number(r.durationMs),
      details: r.details ? safeParseJson(r.details) : undefined,
    }));
  }

  pruneLogs(olderThanTs: number): number {
    const result = this.pruneStmt.run(olderThanTs);
    return Number((result as { changes?: number }).changes || 0);
  }
}

function safeParseJson(s: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function cryptoRandomId(): string {
  // Lightweight UUID-ish id; avoids adding a dependency
  const rnd = Math.random().toString(16).slice(2);
  const ts = Date.now().toString(16);
  return `${ts}-${rnd}`;
}