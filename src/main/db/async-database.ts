import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

interface WorkerRequest {
  id: string;
  method: string;
  params: WorkerParams;
}

interface WorkerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

interface AsyncDatabaseOptions {
  encryptionKey?: string;
}

// Database operation parameter types
interface SqlParams {
  sql: string;
  params?: unknown[];
}

interface StmtParams {
  stmtId: string;
  params: unknown[];
}

interface PrepareParams {
  sql: string;
}

interface StmtFinalizeParams {
  stmtId: string;
}

type WorkerParams = SqlParams | StmtParams | PrepareParams | StmtFinalizeParams | { sql: string };

// Database result types
interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class AsyncDatabase extends EventEmitter {
  private worker: Worker;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private originalWorkerData?: {
    dbPath: string;
    options?: AsyncDatabaseOptions;
  };
  private readonly dbPath: string;
  private readonly options?: AsyncDatabaseOptions;

  constructor(dbPath: string, options?: AsyncDatabaseOptions) {
    super();
    this.dbPath = dbPath;
    this.options = options;
    
    // Create worker thread
    this.worker = new Worker(
      path.join(__dirname, 'database-worker.js'),
      {
        workerData: { dbPath, ...options }
      }
    );

    this.setupWorkerHandlers();
  }

  // Core database operations
  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    return this.sendToWorker('run', { sql, params }) as Promise<RunResult>;
  }

  async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return this.sendToWorker('get', { sql, params }) as Promise<T | undefined>;
  }

  async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.sendToWorker('all', { sql, params }) as Promise<T[]>;
  }

  async exec(sql: string): Promise<void> {
    return this.sendToWorker('exec', { sql }) as Promise<void>;
  }

  // Transaction support
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn();
      await this.exec('COMMIT');
      return result;
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }

  // Prepared statements
  async prepare(sql: string): Promise<PreparedStatement> {
    const stmtId = await this.sendToWorker('prepare', { sql }) as string;
    return new PreparedStatement(this, stmtId);
  }

  sendToWorker(method: string, params: WorkerParams): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      
      // Set timeout for long-running queries
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Database operation timed out: ${method}`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(id, { resolve, reject, timeout });
      
      const request: WorkerRequest = { id, method, params };
      this.worker.postMessage(request);
    });
  }

  private handleWorkerError(error: Error) {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Worker terminated: ${error.message}`));
    }
    this.pendingRequests.clear();
    
    // Attempt to restart worker
    this.restartWorker();
  }

  private async restartWorker() {
    console.log('Attempting to restart database worker...');
    try {
      // Store original worker data if not already stored
      if (!this.originalWorkerData) {
        this.originalWorkerData = {
          dbPath: this.dbPath,
          options: this.options
        };
      }
      
      // Terminate existing worker
      if (this.worker) {
        await this.worker.terminate();
      }
      
      // Create new worker
      this.worker = new Worker(
        path.join(__dirname, 'database-worker.js'),
        { workerData: this.originalWorkerData }
      );
      
      // Re-setup event handlers
      this.setupWorkerHandlers();
      
      console.log('Database worker restarted successfully');
    } catch (error) {
      console.error('Failed to restart worker:', error);
      throw new Error(`Worker restart failed: ${(error as Error).message}`);
    }
  }

  private setupWorkerHandlers() {
    // Handle worker messages
    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        
        if (response.error) {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response.result);
        }
      }
    });

    // Handle worker errors
    this.worker.on('error', (error) => {
      console.error('Worker error:', error);
      this.handleWorkerError(error);
    });
    
    // Handle worker exit
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker exited with code ${code}`);
      }
    });
  }

  async close() {
    await this.worker.terminate();
  }
}

// Prepared statement wrapper
export class PreparedStatement {
  constructor(
    private db: AsyncDatabase,
    private stmtId: string
  ) {}

  async run(...params: unknown[]): Promise<RunResult> {
    return this.db.sendToWorker('stmt_run', { 
      stmtId: this.stmtId, 
      params 
    }) as Promise<RunResult>;
  }

  async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
    return this.db.sendToWorker('stmt_get', { 
      stmtId: this.stmtId, 
      params 
    }) as Promise<T | undefined>;
  }

  async all<T = unknown>(...params: unknown[]): Promise<T[]> {
    return this.db.sendToWorker('stmt_all', { 
      stmtId: this.stmtId, 
      params 
    }) as Promise<T[]>;
  }

  async finalize(): Promise<void> {
    return this.db.sendToWorker('stmt_finalize', { 
      stmtId: this.stmtId 
    }) as Promise<void>;
  }
}