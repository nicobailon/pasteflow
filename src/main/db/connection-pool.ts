import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import * as crypto from 'node:crypto';

import Database from 'better-sqlite3';

export interface PoolConnectionOptions {
  encryptionKey?: string;
  timeout?: number;
  maxIdleTime?: number;
  healthCheckInterval?: number;
}

export interface ConnectionPoolConfig {
  minReadConnections: number;
  maxReadConnections: number;
  maxWaitingClients: number;
  acquireTimeout: number;
  idleTimeout: number;
  healthCheckInterval: number;
  connectionOptions?: PoolConnectionOptions;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  totalQueries: number;
  averageQueryTime: number;
  connectionAcquireTime: number;
  poolUtilization: number;
}

// Precise parameter types for database operations
export type SqlParameter = string | number | boolean | null | Buffer | bigint;
export type SqlParameters = SqlParameter[];

// Query result types
export type QueryResult = Record<string, SqlParameter>;
export type QueryResults = QueryResult[];

interface PoolConnection {
  id: string;
  db: Database.Database;
  isWriteConnection: boolean;
  isActive: boolean;
  lastUsed: number;
  totalQueries: number;
  averageQueryTime: number;
  createdAt: number;
  isHealthy: boolean;
}

interface QueuedRequest {
  resolve: (connection: PoolConnection) => void;
  reject: (error: Error) => void;
  timestamp: number;
  requestType: 'read' | 'write';
  timeout: NodeJS.Timeout;
}

export class ConnectionPool extends EventEmitter {
  private readonly dbPath: string;
  private readonly config: ConnectionPoolConfig;
  private connections: Map<string, PoolConnection> = new Map();
  private writeConnection: PoolConnection | null = null;
  private readConnections: Set<PoolConnection> = new Set();
  private idleConnections: Set<PoolConnection> = new Set();
  private waitingQueue: QueuedRequest[] = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private totalQueries = 0;
  private totalQueryTime = 0;
  
  // Performance tracking
  private queryMetrics = new Map<string, {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
  }>();

  constructor(dbPath: string, config: Partial<ConnectionPoolConfig> = {}) {
    super();
    this.dbPath = dbPath;
    this.config = {
      minReadConnections: 2,
      maxReadConnections: 10,
      maxWaitingClients: 100,
      acquireTimeout: 30_000, // 30 seconds
      idleTimeout: 300_000, // 5 minutes
      healthCheckInterval: 60_000, // 1 minute
      ...config
    };

    this.setupHealthCheck();
  }

  async initialize(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    try {
      // Create write connection
      this.writeConnection = await this.createConnection(true);
      console.log('Write connection established');

      // Create minimum read connections
      for (let i = 0; i < this.config.minReadConnections; i++) {
        const connection = await this.createConnection(false);
        this.readConnections.add(connection);
        this.idleConnections.add(connection);
      }

      console.log(`Connection pool initialized with ${this.config.minReadConnections} read connections`);
      this.emit('initialized', this.getStats());
    } catch (error) {
      console.error('Failed to initialize connection pool:', error);
      throw error;
    }
  }

  private async createConnection(isWrite: boolean): Promise<PoolConnection> {
    const connectionId = `${isWrite ? 'write' : 'read'}_${crypto.randomUUID()}`;
    
    try {
      const db = new Database(this.dbPath);
      
      // Apply encryption if configured
      if (this.config.connectionOptions?.encryptionKey) {
        db.pragma(`cipher = 'aes-256-cbc'`);
        db.pragma(`key = '${this.config.connectionOptions.encryptionKey}'`);
        db.pragma('cipher_integrity_check = 1');
        db.pragma('cipher_memory_security = ON');
      }

      // Performance optimizations
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -64000'); // 64MB cache
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 268435456'); // 256MB mmap

      // Connection-specific optimizations
      if (isWrite) {
        db.pragma('wal_autocheckpoint = 1000');
        db.pragma('busy_timeout = 30000'); // 30 second timeout for writes
      } else {
        db.pragma('query_only = 1'); // Read-only mode for read connections
        db.pragma('busy_timeout = 5000'); // 5 second timeout for reads
      }

      const connection: PoolConnection = {
        id: connectionId,
        db,
        isWriteConnection: isWrite,
        isActive: false,
        lastUsed: Date.now(),
        totalQueries: 0,
        averageQueryTime: 0,
        createdAt: Date.now(),
        isHealthy: true
      };

      // Test connection with a simple query
      await this.testConnection(connection);

      this.connections.set(connectionId, connection);
      
      this.emit('connectionCreated', {
        connectionId,
        isWrite,
        totalConnections: this.connections.size
      });

      return connection;
    } catch (error) {
      console.error(`Failed to create ${isWrite ? 'write' : 'read'} connection:`, error);
      throw new Error(`Connection creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async testConnection(connection: PoolConnection): Promise<void> {
    try {
      const result = connection.db.prepare('SELECT 1 as test').get() as { test: number } | undefined;
      if (!result || result.test !== 1) {
        throw new Error('Connection health check failed');
      }
    } catch (error) {
      connection.isHealthy = false;
      throw new Error(`Connection test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async acquireReadConnection(): Promise<PoolConnection> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    // Try to find an idle read connection
    for (const connection of this.idleConnections) {
      if (!connection.isWriteConnection && connection.isHealthy) {
        this.idleConnections.delete(connection);
        connection.isActive = true;
        connection.lastUsed = Date.now();
        return connection;
      }
    }

    // Try to create a new connection if under max limit
    if (this.readConnections.size < this.config.maxReadConnections) {
      try {
        const connection = await this.createConnection(false);
        this.readConnections.add(connection);
        connection.isActive = true;
        return connection;
      } catch (error) {
        console.warn('Failed to create new read connection:', error);
      }
    }

    // Queue the request
    return this.queueRequest('read');
  }

  async acquireWriteConnection(): Promise<PoolConnection> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    if (!this.writeConnection) {
      throw new Error('Write connection not available');
    }

    if (!this.writeConnection.isActive && this.writeConnection.isHealthy) {
      this.writeConnection.isActive = true;
      this.writeConnection.lastUsed = Date.now();
      return this.writeConnection;
    }

    // Queue the request for write connection
    return this.queueRequest('write');
  }

  private async queueRequest(type: 'read' | 'write'): Promise<PoolConnection> {
    if (this.waitingQueue.length >= this.config.maxWaitingClients) {
      throw new Error('Too many clients waiting for connections');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.waitingQueue.findIndex(req => req.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error(`Timeout acquiring ${type} connection after ${this.config.acquireTimeout}ms`));
      }, this.config.acquireTimeout);

      const request: QueuedRequest = {
        resolve,
        reject,
        timestamp: Date.now(),
        requestType: type,
        timeout
      };

      this.waitingQueue.push(request);
      this.emit('clientQueued', {
        type,
        queueLength: this.waitingQueue.length,
        waitTime: 0
      });
    });
  }

  releaseConnection(connection: PoolConnection): void {
    if (!connection.isActive) {
      console.warn('Attempting to release inactive connection:', connection.id);
      return;
    }

    connection.isActive = false;
    connection.lastUsed = Date.now();

    // Check if there are queued requests
    const queuedRequest = this.waitingQueue.find(req => {
      return connection.isWriteConnection ? req.requestType === 'write' : req.requestType === 'read';
    });

    if (queuedRequest) {
      // Remove from queue
      const index = this.waitingQueue.indexOf(queuedRequest);
      this.waitingQueue.splice(index, 1);
      
      clearTimeout(queuedRequest.timeout);
      
      connection.isActive = true;
      connection.lastUsed = Date.now();
      
      const waitTime = Date.now() - queuedRequest.timestamp;
      this.emit('clientDequeued', {
        type: queuedRequest.requestType,
        waitTime,
        queueLength: this.waitingQueue.length
      });
      
      queuedRequest.resolve(connection);
    } else {
      // Add back to idle connections
      this.idleConnections.add(connection);
    }
  }

  async executeQuery<T extends QueryResult>(
    sql: string, 
    params: SqlParameters = [], 
    type: 'read' | 'write' = 'read'
  ): Promise<T> {
    const startTime = performance.now();
    const connection = type === 'write' 
      ? await this.acquireWriteConnection()
      : await this.acquireReadConnection();

    try {
      const stmt = connection.db.prepare(sql);
      const result = stmt.get(...params) as T;
      
      this.updateQueryMetrics(sql, performance.now() - startTime);
      this.updateConnectionMetrics(connection, performance.now() - startTime);
      
      return result;
    } catch (error) {
      this.emit('queryError', {
        sql,
        params,
        error: error instanceof Error ? error.message : String(error),
        connectionId: connection.id
      });
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeQueryAll<T extends QueryResult>(
    sql: string, 
    params: SqlParameters = [], 
    type: 'read' | 'write' = 'read'
  ): Promise<T[]> {
    const startTime = performance.now();
    const connection = type === 'write' 
      ? await this.acquireWriteConnection()
      : await this.acquireReadConnection();

    try {
      const stmt = connection.db.prepare(sql);
      const result = stmt.all(...params) as T[];
      
      this.updateQueryMetrics(sql, performance.now() - startTime);
      this.updateConnectionMetrics(connection, performance.now() - startTime);
      
      return result;
    } catch (error) {
      this.emit('queryError', {
        sql,
        params,
        error: error instanceof Error ? error.message : String(error),
        connectionId: connection.id
      });
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeQueryRun(
    sql: string, 
    params: SqlParameters = []
  ): Promise<Database.RunResult> {
    const startTime = performance.now();
    const connection = await this.acquireWriteConnection();

    try {
      const stmt = connection.db.prepare(sql);
      const result = stmt.run(...params);
      
      this.updateQueryMetrics(sql, performance.now() - startTime);
      this.updateConnectionMetrics(connection, performance.now() - startTime);
      
      return result;
    } catch (error) {
      this.emit('queryError', {
        sql,
        params,
        error: error instanceof Error ? error.message : String(error),
        connectionId: connection.id
      });
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  async transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.acquireWriteConnection();
    const startTime = performance.now();

    try {
      connection.db.exec('BEGIN IMMEDIATE');
      const result = await fn(connection);
      connection.db.exec('COMMIT');
      
      this.updateQueryMetrics('TRANSACTION', performance.now() - startTime);
      return result;
    } catch (error) {
      try {
        connection.db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback transaction:', rollbackError);
      }
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  private updateQueryMetrics(sql: string, duration: number): void {
    this.totalQueries++;
    this.totalQueryTime += duration;

    const queryType = sql.trim().split(' ')[0].toUpperCase();
    const metrics = this.queryMetrics.get(queryType) || {
      count: 0,
      totalTime: 0,
      minTime: Number.POSITIVE_INFINITY,
      maxTime: 0
    };

    metrics.count++;
    metrics.totalTime += duration;
    metrics.minTime = Math.min(metrics.minTime, duration);
    metrics.maxTime = Math.max(metrics.maxTime, duration);

    this.queryMetrics.set(queryType, metrics);
  }

  private updateConnectionMetrics(connection: PoolConnection, duration: number): void {
    connection.totalQueries++;
    const newAverage = (connection.averageQueryTime * (connection.totalQueries - 1) + duration) / connection.totalQueries;
    connection.averageQueryTime = newAverage;
  }

  private setupHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isShuttingDown) return;

      await this.performHealthCheck();
      await this.cleanupIdleConnections();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const unhealthyConnections: PoolConnection[] = [];

    for (const connection of this.connections.values()) {
      if (!connection.isActive) {
        try {
          await this.testConnection(connection);
        } catch (error) {
          console.warn(`Connection ${connection.id} failed health check:`, error);
          unhealthyConnections.push(connection);
        }
      }
    }

    // Remove unhealthy connections
    for (const connection of unhealthyConnections) {
      await this.removeConnection(connection);
    }

    // Ensure minimum read connections
    const healthyReadConnections = [...this.readConnections].filter(c => c.isHealthy);
    if (healthyReadConnections.length < this.config.minReadConnections) {
      const needed = this.config.minReadConnections - healthyReadConnections.length;
      for (let i = 0; i < needed; i++) {
        try {
          const connection = await this.createConnection(false);
          this.readConnections.add(connection);
          this.idleConnections.add(connection);
        } catch (error) {
          console.error('Failed to create replacement read connection:', error);
        }
      }
    }

    this.emit('healthCheck', {
      totalConnections: this.connections.size,
      unhealthyRemoved: unhealthyConnections.length,
      stats: this.getStats()
    });
  }

  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const connectionsToRemove: PoolConnection[] = [];

    for (const connection of this.idleConnections) {
      const idleTime = now - connection.lastUsed;
      if (idleTime > this.config.idleTimeout && this.readConnections.size > this.config.minReadConnections) {
        connectionsToRemove.push(connection);
      }
    }

    for (const connection of connectionsToRemove) {
      await this.removeConnection(connection);
    }

    if (connectionsToRemove.length > 0) {
      this.emit('idleCleanup', {
        removed: connectionsToRemove.length,
        remainingIdle: this.idleConnections.size
      });
    }
  }

  private async removeConnection(connection: PoolConnection): Promise<void> {
    try {
      if (!connection.isActive) {
        connection.db.close();
      }
    } catch (error) {
      console.warn(`Error closing connection ${connection.id}:`, error);
    }

    this.connections.delete(connection.id);
    this.readConnections.delete(connection);
    this.idleConnections.delete(connection);

    if (connection === this.writeConnection) {
      // Recreate write connection
      try {
        this.writeConnection = await this.createConnection(true);
      } catch (error) {
        console.error('Failed to recreate write connection:', error);
        this.writeConnection = null;
      }
    }

    this.emit('connectionRemoved', {
      connectionId: connection.id,
      isWrite: connection.isWriteConnection,
      totalConnections: this.connections.size
    });
  }

  getStats(): PoolStats {
    const activeConnections = [...this.connections.values()].filter(c => c.isActive).length;
    
    return {
      totalConnections: this.connections.size,
      activeConnections,
      idleConnections: this.idleConnections.size,
      waitingClients: this.waitingQueue.length,
      totalQueries: this.totalQueries,
      averageQueryTime: this.totalQueries > 0 ? this.totalQueryTime / this.totalQueries : 0,
      connectionAcquireTime: this.waitingQueue.length > 0 
        ? Math.max(...this.waitingQueue.map(r => Date.now() - r.timestamp))
        : 0,
      poolUtilization: this.connections.size > 0 ? (activeConnections / this.connections.size) * 100 : 0
    };
  }

  getQueryMetrics(): Map<string, {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
    averageTime: number;
  }> {
    const result = new Map();
    
    for (const [queryType, metrics] of this.queryMetrics) {
      result.set(queryType, {
        ...metrics,
        averageTime: metrics.count > 0 ? metrics.totalTime / metrics.count : 0
      });
    }
    
    return result;
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Reject all waiting requests
    for (const request of this.waitingQueue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection pool is shutting down'));
    }
    this.waitingQueue.length = 0;

    // Wait for active connections to be released (with timeout)
    const shutdownTimeout = 10_000; // 10 seconds
    const start = Date.now();
    
    while (this.getStats().activeConnections > 0 && (Date.now() - start) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Force close all connections
    for (const connection of this.connections.values()) {
      try {
        connection.db.close();
      } catch (error) {
        console.warn(`Error closing connection ${connection.id} during shutdown:`, error);
      }
    }

    this.connections.clear();
    this.readConnections.clear();
    this.idleConnections.clear();
    this.writeConnection = null;

    this.emit('shutdown', {
      finalStats: this.getStats(),
      shutdownDuration: Date.now() - start
    });

    console.log('Connection pool shutdown complete');
  }
}