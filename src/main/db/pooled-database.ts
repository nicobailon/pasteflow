import { ConnectionPool, ConnectionPoolConfig, PoolStats, SqlParameters, QueryResult } from './connection-pool';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

// Precise types for cache and configuration
export type CacheableResult = QueryResult | QueryResult[];
export type DatabaseOperationType = 'get' | 'all' | 'run';

// Connection type for transactions
export interface TransactionConnection {
  db: Database.Database;
  id: string;
  isActive: boolean;
}

export interface PooledDatabaseConfig extends Partial<ConnectionPoolConfig> {
  enablePerformanceMonitoring?: boolean;
  logSlowQueries?: boolean;
  slowQueryThreshold?: number;
  enableQueryCache?: boolean;
  queryCacheSize?: number;
  queryCacheTTL?: number;
}

export interface QueryCacheEntry {
  result: CacheableResult;
  timestamp: number;
  hitCount: number;
}

export interface PerformanceMetrics {
  queriesPerSecond: number;
  averageResponseTime: number;
  cacheHitRate: number;
  slowQueries: number;
  activeConnections: number;
  poolUtilization: number;
}

export class PooledDatabase extends EventEmitter {
  private pool: ConnectionPool;
  private config: PooledDatabaseConfig;
  private queryCache = new Map<string, QueryCacheEntry>();
  private performanceStartTime = Date.now();
  private slowQueries = 0;
  private totalCacheHits = 0;
  private totalCacheRequests = 0;
  private prepared = new Map<string, string>();

  constructor(dbPath: string, config: PooledDatabaseConfig = {}) {
    super();
    
    this.config = {
      minReadConnections: 3,
      maxReadConnections: 15,
      maxWaitingClients: 50,
      acquireTimeout: 15000,
      idleTimeout: 300000,
      healthCheckInterval: 30000,
      enablePerformanceMonitoring: true,
      logSlowQueries: true,
      slowQueryThreshold: 100, // 100ms
      enableQueryCache: true,
      queryCacheSize: 1000,
      queryCacheTTL: 300000, // 5 minutes
      ...config
    };

    this.pool = new ConnectionPool(dbPath, this.config);
    this.setupEventHandlers();
    
    if (this.config.enableQueryCache) {
      this.setupCacheCleanup();
    }
  }

  async initialize(): Promise<void> {
    await this.pool.initialize();
    this.emit('initialized', {
      config: this.config,
      stats: this.getStats()
    });
  }

  private setupEventHandlers(): void {
    this.pool.on('queryError', (data) => {
      this.emit('queryError', data);
    });

    this.pool.on('healthCheck', (data) => {
      this.emit('healthCheck', data);
    });

    this.pool.on('connectionCreated', (data) => {
      this.emit('connectionCreated', data);
    });

    this.pool.on('connectionRemoved', (data) => {
      this.emit('connectionRemoved', data);
    });
  }

  private setupCacheCleanup(): void {
    setInterval(() => {
      this.cleanupQueryCache();
    }, this.config.queryCacheTTL! / 2); // Clean up every 2.5 minutes
  }

  private cleanupQueryCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.queryCache) {
      if (now - entry.timestamp > this.config.queryCacheTTL!) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.queryCache.delete(key);
    }

    // Limit cache size
    if (this.queryCache.size > this.config.queryCacheSize!) {
      const sortedEntries = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = sortedEntries.slice(0, sortedEntries.length - this.config.queryCacheSize!);
      for (const [key] of toRemove) {
        this.queryCache.delete(key);
      }
    }

    this.emit('cacheCleanup', {
      expiredKeys: expiredKeys.length,
      currentSize: this.queryCache.size,
      maxSize: this.config.queryCacheSize
    });
  }

  private getCacheKey(sql: string, params: SqlParameters): string {
    return crypto.createHash('sha256')
      .update(sql)
      .update(JSON.stringify(params))
      .digest('hex');
  }

  private async executeWithCache<T extends CacheableResult>(
    sql: string,
    params: SqlParameters,
    executor: () => Promise<T>,
    cacheable = false
  ): Promise<T> {
    const startTime = Date.now();
    
    // Check cache for read queries
    if (cacheable && this.config.enableQueryCache) {
      const cacheKey = this.getCacheKey(sql, params);
      const cached = this.queryCache.get(cacheKey);
      
      this.totalCacheRequests++;
      
      if (cached) {
        cached.hitCount++;
        this.totalCacheHits++;
        
        this.emit('cacheHit', {
          sql: sql.substring(0, 100),
          hitCount: cached.hitCount,
          age: Date.now() - cached.timestamp
        });
        
        return cached.result as T;
      }
    }

    // Execute query
    const result = await executor();
    const duration = Date.now() - startTime;

    // Performance monitoring
    if (this.config.enablePerformanceMonitoring) {
      if (duration > this.config.slowQueryThreshold!) {
        this.slowQueries++;
        
        if (this.config.logSlowQueries) {
          console.warn(`Slow query detected (${duration}ms):`, {
            sql: sql.substring(0, 200),
            params: params.length,
            duration
          });
        }
        
        this.emit('slowQuery', {
          sql,
          params,
          duration,
          threshold: this.config.slowQueryThreshold
        });
      }
    }

    // Cache result for read queries
    if (cacheable && this.config.enableQueryCache) {
      const cacheKey = this.getCacheKey(sql, params);
      this.queryCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
        hitCount: 0
      });
    }

    return result;
  }

  // Core query methods
  async get<T extends QueryResult>(sql: string, params: SqlParameters = []): Promise<T | undefined> {
    const isReadQuery = sql.trim().toUpperCase().startsWith('SELECT');
    
    return this.executeWithCache(
      sql,
      params,
      () => this.pool.executeQuery<T>(sql, params, 'read'),
      isReadQuery
    );
  }

  async all<T extends QueryResult>(sql: string, params: SqlParameters = []): Promise<T[]> {
    const isReadQuery = sql.trim().toUpperCase().startsWith('SELECT');
    
    return this.executeWithCache(
      sql,
      params,
      () => this.pool.executeQueryAll<T>(sql, params, 'read'),
      isReadQuery
    );
  }

  async run(sql: string, params: SqlParameters = []): Promise<Database.RunResult> {
    const result = await this.executeWithCache(
      sql,
      params,
      () => this.pool.executeQueryRun(sql, params),
      false
    );

    // Invalidate cache for write operations
    if (this.config.enableQueryCache) {
      const isWriteOperation = /^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql.trim());
      if (isWriteOperation) {
        this.invalidateCache();
      }
    }

    return result;
  }

  async exec(sql: string): Promise<void> {
    const connection = await this.pool.acquireWriteConnection();
    try {
      connection.db.exec(sql);
      
      // Invalidate cache for DDL operations
      if (this.config.enableQueryCache) {
        this.invalidateCache();
      }
    } finally {
      this.pool.releaseConnection(connection);
    }
  }

  // Transaction support with automatic retry
  async transaction<T>(
    fn: (db: PooledDatabase) => Promise<T>,
    retries = 3
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this.pool.transaction(async (connection) => {
          // Create a transaction-scoped database wrapper
          const txDatabase = new TransactionDatabase(connection, this);
          return await fn(txDatabase as PooledDatabase);
        });
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable (SQLITE_BUSY, SQLITE_LOCKED)
        const isRetryable = error.message.includes('SQLITE_BUSY') || 
                           error.message.includes('SQLITE_LOCKED') ||
                           error.message.includes('database is locked');
        
        if (!isRetryable || attempt === retries) {
          throw error;
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        this.emit('transactionRetry', {
          attempt,
          error: error.message,
          nextDelay: attempt < retries ? Math.min(1000 * Math.pow(2, attempt), 10000) : null
        });
      }
    }
    
    throw lastError!;
  }

  // Prepared statement management
  async prepare(sql: string): Promise<string> {
    const statementId = crypto.randomUUID();
    this.prepared.set(statementId, sql);
    return statementId;
  }

  async executePrepared<T extends CacheableResult | Database.RunResult>(
    statementId: string,
    params: SqlParameters = [],
    operation: DatabaseOperationType = 'get'
  ): Promise<T> {
    const sql = this.prepared.get(statementId);
    if (!sql) {
      throw new Error(`Prepared statement not found: ${statementId}`);
    }

    switch (operation) {
      case 'get':
        return this.get<T>(sql, params) as Promise<T>;
      case 'all':
        return this.all<T>(sql, params) as Promise<T>;
      case 'run':
        return this.run(sql, params) as Promise<T>;
      default:
        throw new Error(`Invalid operation: ${operation}`);
    }
  }

  finalizePrepared(statementId: string): void {
    this.prepared.delete(statementId);
  }

  // Cache management
  private invalidateCache(): void {
    if (this.config.enableQueryCache) {
      this.queryCache.clear();
      this.emit('cacheInvalidated', {
        reason: 'write_operation',
        previousSize: this.queryCache.size
      });
    }
  }

  invalidateCachePattern(pattern: string): void {
    if (!this.config.enableQueryCache) return;

    const regex = new RegExp(pattern, 'i');
    const keysToDelete: string[] = [];

    for (const [key] of this.queryCache) {
      // We can't easily match against original SQL, so we'll clear all for safety
      keysToDelete.push(key);
    }

    for (const key of keysToDelete) {
      this.queryCache.delete(key);
    }

    this.emit('cacheInvalidated', {
      reason: 'pattern_match',
      pattern,
      keysRemoved: keysToDelete.length
    });
  }

  clearCache(): void {
    const size = this.queryCache.size;
    this.queryCache.clear();
    this.emit('cacheCleared', { previousSize: size });
  }

  // Performance and statistics
  getStats(): PoolStats {
    return this.pool.getStats();
  }

  getPerformanceMetrics(): PerformanceMetrics {
    const stats = this.pool.getStats();
    const runtime = Date.now() - this.performanceStartTime;
    
    return {
      queriesPerSecond: stats.totalQueries > 0 ? (stats.totalQueries / (runtime / 1000)) : 0,
      averageResponseTime: stats.averageQueryTime,
      cacheHitRate: this.totalCacheRequests > 0 ? (this.totalCacheHits / this.totalCacheRequests) * 100 : 0,
      slowQueries: this.slowQueries,
      activeConnections: stats.activeConnections,
      poolUtilization: stats.poolUtilization
    };
  }

  getQueryMetrics() {
    return this.pool.getQueryMetrics();
  }

  getCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.config.queryCacheSize,
      hitRate: this.totalCacheRequests > 0 ? (this.totalCacheHits / this.totalCacheRequests) * 100 : 0,
      totalHits: this.totalCacheHits,
      totalRequests: this.totalCacheRequests
    };
  }

  // Health check
  async healthCheck(): Promise<{
    isHealthy: boolean;
    stats: PoolStats;
    performance: PerformanceMetrics;
    cache?: object;
  }> {
    try {
      // Test basic connectivity
      await this.get('SELECT 1 as test');
      
      const stats = this.getStats();
      const performance = this.getPerformanceMetrics();
      const cache = this.config.enableQueryCache ? this.getCacheStats() : undefined;
      
      return {
        isHealthy: true,
        stats,
        performance,
        cache
      };
    } catch (error) {
      return {
        isHealthy: false,
        stats: this.getStats(),
        performance: this.getPerformanceMetrics(),
        cache: this.config.enableQueryCache ? this.getCacheStats() : undefined
      };
    }
  }

  // Shutdown
  async shutdown(): Promise<void> {
    this.clearCache();
    await this.pool.shutdown();
    this.emit('shutdown');
  }
}

// Transaction-scoped database wrapper
class TransactionDatabase {
  constructor(
    private connection: TransactionConnection,
    private parentDb: PooledDatabase
  ) {}

  async get<T extends QueryResult>(sql: string, params: SqlParameters = []): Promise<T | undefined> {
    const stmt = this.connection.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  async all<T extends QueryResult>(sql: string, params: SqlParameters = []): Promise<T[]> {
    const stmt = this.connection.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async run(sql: string, params: SqlParameters = []): Promise<Database.RunResult> {
    const stmt = this.connection.db.prepare(sql);
    return stmt.run(...params);
  }

  async exec(sql: string): Promise<void> {
    this.connection.db.exec(sql);
  }

  // Delegate other methods to parent
  getStats() {
    return this.parentDb.getStats();
  }

  getPerformanceMetrics() {
    return this.parentDb.getPerformanceMetrics();
  }
}