import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';

import { v4 as uuidv4 } from 'uuid';

import { retryWorkerOperation, retryUtility, DatabaseErrorType, executeWithRetry } from './retry-utils';

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
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class AsyncDatabase extends EventEmitter {
  private worker!: Worker;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    operation: string;
    retryCount: number;
  }>();
  private originalWorkerData?: {
    dbPath: string;
    options?: AsyncDatabaseOptions;
  };
  private readonly dbPath: string;
  private readonly options?: AsyncDatabaseOptions;
  private isRestarting = false;
  private restartCount = 0;
  private maxRestarts = 3;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(dbPath: string, options?: AsyncDatabaseOptions) {
    super();
    this.dbPath = dbPath;
    this.options = options;
    
    // Create worker thread with enhanced error handling
    this.createWorker();
    this.setupHealthCheck();
  }

  private createWorker(): void {
    try {
      this.worker = new Worker(
        // eslint-disable-next-line unicorn/prefer-module
        path.join(__dirname, 'database-worker.ts'),
        {
          workerData: { dbPath: this.dbPath, ...this.options }
        }
      );
      this.setupWorkerHandlers();
      console.log('Database worker created successfully');
    } catch (error) {
      console.error('Failed to create database worker:', error);
      throw new Error(`Worker creation failed: ${(error as Error).message}`);
    }
  }

  private setupHealthCheck(): void {
    // Periodic health check every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.warn('Database worker health check failed:', error);
        retryUtility.emit('worker:health_check_failed', { error });
      }
    }, 30_000);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      await this.get('SELECT 1 as health_check', []);
    } catch (error) {
      throw new Error(`Health check failed: ${(error as Error).message}`);
    }
  }

  // Core database operations with retry support
  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    return await retryWorkerOperation(async () => {
      return this.sendToWorker('run', { sql, params }) as Promise<RunResult>;
    });
  }

  async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return await retryWorkerOperation(async () => {
      return this.sendToWorker('get', { sql, params }) as Promise<T | undefined>;
    });
  }

  async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return await retryWorkerOperation(async () => {
      return this.sendToWorker('all', { sql, params }) as Promise<T[]>;
    });
  }

  async exec(sql: string): Promise<void> {
    return await retryWorkerOperation(async () => {
      return this.sendToWorker('exec', { sql }) as Promise<void>;
    });
  }

  // Instructions methods
  async listInstructions(): Promise<{
    id: string;
    name: string;
    content: string;
    created_at: number;
    updated_at: number;
  }[]> {
    return await this.all(
      'SELECT id, name, content, created_at, updated_at FROM instructions ORDER BY updated_at DESC'
    );
  }

  async createInstruction(id: string, name: string, content: string): Promise<void> {
    await this.run(
      'INSERT INTO instructions (id, name, content) VALUES (?, ?, ?)',
      [id, name, content]
    );
  }

  async updateInstruction(id: string, name: string, content: string): Promise<void> {
    const result = await this.run(
      "UPDATE instructions SET name = ?, content = ?, updated_at = strftime('%s', 'now') * 1000 WHERE id = ?",
      [name, content, id]
    );
    if (result.changes === 0) {
      throw new Error(`Instruction with id '${id}' not found`);
    }
  }

  async deleteInstruction(id: string): Promise<void> {
    const result = await this.run(
      'DELETE FROM instructions WHERE id = ?',
      [id]
    );
    if (result.changes === 0) {
      throw new Error(`Instruction with id '${id}' not found`);
    }
  }

  // Enhanced transaction support with retry
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const retryResult = await executeWithRetry(async () => {
      await this.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await this.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          await this.exec('ROLLBACK');
        } catch (rollbackError) {
          console.error('Transaction rollback failed:', rollbackError);
        }
        throw error;
      }
    }, {
      maxRetries: 3,
      retryableErrors: [
        'SQLITE_BUSY',
        'SQLITE_LOCKED',
        'database is locked',
        'deadlock'
      ]
    });
    
    if (!retryResult.success || !retryResult.result) {
      throw retryResult.error || new Error('Transaction failed');
    }
    return retryResult.result;
  }

  // Prepared statements
  async prepare(sql: string): Promise<PreparedStatement> {
    const stmtId = await this.sendToWorker('prepare', { sql }) as string;
    return new PreparedStatement(this, stmtId);
  }

  sendToWorker(method: string, params: WorkerParams): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      
      // Enhanced timeout with operation-specific durations
      const timeoutDuration = this.getTimeoutForOperation(method);
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          const error = new Error(`Database operation timed out after ${timeoutDuration}ms: ${method}`);
          retryUtility.emit('worker:timeout', { method, id, duration: timeoutDuration });
          reject(error);
        }
      }, timeoutDuration);

      this.pendingRequests.set(id, { 
        resolve, 
        reject, 
        timeout, 
        operation: method,
        retryCount: 0
      });
      
      const request: WorkerRequest = { id, method, params };
      
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new Error(`Failed to send message to worker: ${(error as Error).message}`));
      }
    });
  }

  private getTimeoutForOperation(method: string): number {
    const timeouts: Record<string, number> = {
      'exec': 60_000,        // Schema operations may take longer
      'run': 30_000,         // Standard operations
      'get': 15_000,         // Quick reads
      'all': 45_000,         // Bulk reads
      'prepare': 10_000,     // Statement preparation
      'stmt_run': 30_000,    // Prepared statement execution
      'stmt_get': 15_000,    // Prepared statement reads
      'stmt_all': 45_000,    // Prepared statement bulk reads
    };
    
    return timeouts[method] || 30_000; // Default 30 seconds
  }

  private handleWorkerError(error: Error): void {
    console.error('Database worker encountered error:', error);
    
    const errorType = this.classifyWorkerError(error);
    retryUtility.emit('worker:error', { error, errorType });
    
    // Reject all pending requests with enhanced error information
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      const enhancedError = new Error(
        `Worker failed (${errorType}): ${error.message}. Operation: ${pending.operation}, Retries: ${pending.retryCount}`
      );
      pending.reject(enhancedError);
    }
    this.pendingRequests.clear();
    
    // Attempt to restart worker with backoff
    this.attemptWorkerRestart(error);
  }

  private classifyWorkerError(error: Error): DatabaseErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes('terminated') || message.includes('exit')) {
      return DatabaseErrorType.WORKER_TERMINATED;
    }
    if (message.includes('timeout')) {
      return DatabaseErrorType.WORKER_TIMEOUT;
    }
    if (message.includes('connection') || message.includes('socket')) {
      return DatabaseErrorType.CONNECTION_FAILED;
    }
    
    return DatabaseErrorType.UNKNOWN;
  }

  private async attemptWorkerRestart(originalError: Error): Promise<void> {
    if (this.isRestarting) {
      console.log('Worker restart already in progress, skipping...');
      return;
    }
    
    if (this.restartCount >= this.maxRestarts) {
      const error = new Error(
        `Worker restart limit exceeded (${this.maxRestarts}). Original error: ${originalError.message}`
      );
      retryUtility.emit('worker:restart_limit_exceeded', { originalError, restartCount: this.restartCount });
      throw error;
    }
    
    this.isRestarting = true;
    this.restartCount++;
    
    console.log(`Attempting worker restart ${this.restartCount}/${this.maxRestarts}...`);
    
    try {
      await executeWithRetry(async () => {
        await this.restartWorker();
      }, {
        operation: 'worker_restart',
        maxRetries: 2,
        baseDelay: 1000 * this.restartCount // Exponential backoff
      });
      
      console.log('Database worker restarted successfully');
      retryUtility.emit('worker:restarted', { restartCount: this.restartCount });
      
    } catch (error) {
      console.error('Failed to restart worker:', error);
      retryUtility.emit('worker:restart_failed', { error, restartCount: this.restartCount });
      throw new Error(`Worker restart failed: ${(error as Error).message}`);
    } finally {
      this.isRestarting = false;
    }
  }

  private async restartWorker(): Promise<void> {
    // Store original worker data if not already stored
    if (!this.originalWorkerData) {
      this.originalWorkerData = {
        dbPath: this.dbPath,
        options: this.options
      };
    }
    
    // Terminate existing worker
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (terminateError) {
        console.warn('Warning: Failed to cleanly terminate worker:', terminateError);
      }
    }
    
    // Create new worker
    this.createWorker();
    
    // Verify worker is responsive
    await this.performHealthCheck();
  }

  private setupWorkerHandlers(): void {
    // Handle worker messages with enhanced logging
    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        
        if (response.error) {
          const error = new Error(response.error);
          retryUtility.emit('worker:operation_failed', {
            operation: pending.operation,
            error: response.error,
            retryCount: pending.retryCount
          });
          pending.reject(error);
        } else {
          retryUtility.emit('worker:operation_success', {
            operation: pending.operation,
            retryCount: pending.retryCount
          });
          pending.resolve(response.result);
        }
      } else {
        console.warn('Received response for unknown request ID:', response.id);
      }
    });

    // Handle worker errors with enhanced reporting
    this.worker.on('error', (error) => {
      console.error('Worker error:', error);
      this.handleWorkerError(error);
    });
    
    // Handle worker exit with restart logic
    this.worker.on('exit', (code) => {
      console.log(`Worker exited with code ${code}`);
      
      if (code !== 0 && !this.isRestarting) {
        const error = new Error(`Worker exited unexpectedly with code ${code}`);
        this.handleWorkerError(error);
      }
      
      retryUtility.emit('worker:exit', { code, isRestarting: this.isRestarting });
    });
    
    // Handle worker online event
    this.worker.on('online', () => {
      console.log('Database worker is online');
      retryUtility.emit('worker:online', { restartCount: this.restartCount });
    });
  }

  async close(): Promise<void> {
    console.log('Closing database worker...');
    
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Database worker is closing'));
    }
    this.pendingRequests.clear();
    
    // Terminate worker with retry
    if (this.worker) {
      try {
        await executeWithRetry(async () => {
          await this.worker.terminate();
        }, {
          operation: 'worker_close',
          maxRetries: 2,
          baseDelay: 1000
        });
      } catch (error) {
        console.warn('Failed to cleanly terminate worker:', error);
      }
    }
    
    retryUtility.emit('worker:closed', { restartCount: this.restartCount });
    console.log('Database worker closed');
  }

  // Monitoring and diagnostics
  getWorkerStats(): {
    pendingRequests: number;
    restartCount: number;
    isRestarting: boolean;
    maxRestarts: number;
  } {
    return {
      pendingRequests: this.pendingRequests.size,
      restartCount: this.restartCount,
      isRestarting: this.isRestarting,
      maxRestarts: this.maxRestarts
    };
  }

  async getStatus(): Promise<{
    healthy: boolean;
    workerStats: {
      pendingRequests: number;
      restartCount: number;
      isRestarting: boolean;
      maxRestarts: number;
    };
    lastHealthCheck?: Date;
  }> {
    let healthy = false;
    let lastHealthCheck: Date | undefined;
    
    try {
      await this.performHealthCheck();
      healthy = true;
      lastHealthCheck = new Date();
    } catch (error) {
      console.warn('Health check failed during status check:', error);
    }
    
    return {
      healthy,
      workerStats: this.getWorkerStats(),
      lastHealthCheck
    };
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