const { EventEmitter } = require('events');

const DatabaseErrorType = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  TRANSACTION_DEADLOCK: 'TRANSACTION_DEADLOCK',
  DATABASE_LOCKED: 'DATABASE_LOCKED',
  DISK_FULL: 'DISK_FULL',
  CORRUPT_DATABASE: 'CORRUPT_DATABASE',
  WORKER_TIMEOUT: 'WORKER_TIMEOUT',
  WORKER_TERMINATED: 'WORKER_TERMINATED',
  UNKNOWN: 'UNKNOWN'
};

class DatabaseRetryUtility extends EventEmitter {
  constructor() {
    super();
    this.retryStats = new Map();
  }

  static getInstance() {
    if (!DatabaseRetryUtility.instance) {
      DatabaseRetryUtility.instance = new DatabaseRetryUtility();
    }
    return DatabaseRetryUtility.instance;
  }

  /**
   * Executes an operation with comprehensive retry logic
   */
  async executeWithRetry(operation, options = {}) {
    const config = {
      maxRetries: 3,
      baseDelay: 100,
      maxDelay: 5000,
      exponentialBase: 2,
      jitterFactor: 0.1,
      retryableErrors: [
        'SQLITE_BUSY',
        'SQLITE_LOCKED',
        'SQLITE_CANTOPEN',
        'SQLITE_PROTOCOL',
        'EBUSY',
        'EAGAIN',
        'Database operation timed out',
        'Worker terminated',
        'Connection failed'
      ],
      operation: 'database_operation',
      ...options
    };

    const attempts = [];
    const startTime = Date.now();
    let lastError;

    // Update stats
    this.updateStats(config.operation, 'attempt');

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const attemptStart = Date.now();
      
      try {
        const result = await operation();
        
        // Record successful attempt
        attempts.push({
          attempt: attempt + 1,
          delay: 0,
          timestamp: attemptStart
        });

        this.updateStats(config.operation, 'success');
        this.emit('retry:success', {
          operation: config.operation,
          attempt: attempt + 1,
          totalTime: Date.now() - startTime
        });

        return {
          success: true,
          result,
          attempts,
          totalTime: Date.now() - startTime
        };

      } catch (error) {
        lastError = error;
        const errorType = this.classifyError(lastError);
        
        // Record failed attempt
        attempts.push({
          attempt: attempt + 1,
          delay: 0,
          error: lastError,
          timestamp: attemptStart
        });

        this.emit('retry:attempt', {
          operation: config.operation,
          attempt: attempt + 1,
          error: lastError,
          errorType
        });

        // Check if error is retryable
        if (!this.isRetryableError(lastError, config.retryableErrors)) {
          this.updateStats(config.operation, 'failure');
          this.emit('retry:failed', {
            operation: config.operation,
            error: lastError,
            reason: 'non_retryable_error',
            attempts
          });

          return {
            success: false,
            error: lastError,
            attempts,
            totalTime: Date.now() - startTime
          };
        }

        // Don't retry on the last attempt
        if (attempt >= config.maxRetries) {
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, config);
        attempts[attempts.length - 1].delay = delay;

        this.emit('retry:delay', {
          operation: config.operation,
          attempt: attempt + 1,
          delay,
          nextAttempt: attempt + 2
        });

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.updateStats(config.operation, 'failure');
    this.emit('retry:exhausted', {
      operation: config.operation,
      finalError: lastError,
      totalAttempts: config.maxRetries + 1,
      totalTime: Date.now() - startTime
    });

    return {
      success: false,
      error: lastError,
      attempts,
      totalTime: Date.now() - startTime
    };
  }

  /**
   * Specialized retry for database connections with exponential backoff
   */
  async retryConnection(connectionFn, maxRetries = 5) {
    const result = await this.executeWithRetry(connectionFn, {
      maxRetries,
      baseDelay: 500,
      maxDelay: 10000,
      exponentialBase: 2.5,
      jitterFactor: 0.2,
      operation: 'database_connection',
      retryableErrors: [
        'SQLITE_BUSY',
        'SQLITE_LOCKED',
        'SQLITE_CANTOPEN',
        'ENOENT',
        'EACCES',
        'Connection failed'
      ]
    });

    if (!result.success) {
      throw new Error(`Connection failed after ${maxRetries + 1} attempts: ${result.error?.message}`);
    }

    return result.result;
  }

  /**
   * Specialized retry for transactions with deadlock handling
   */
  async retryTransaction(transactionFn, maxRetries = 3) {
    const result = await this.executeWithRetry(transactionFn, {
      maxRetries,
      baseDelay: 50,
      maxDelay: 1000,
      exponentialBase: 1.5,
      jitterFactor: 0.3,
      operation: 'database_transaction',
      retryableErrors: [
        'SQLITE_BUSY',
        'SQLITE_LOCKED',
        'database is locked',
        'deadlock'
      ]
    });

    if (!result.success) {
      throw new Error(`Transaction failed after ${maxRetries + 1} attempts: ${result.error?.message}`);
    }

    return result.result;
  }

  /**
   * Specialized retry for worker operations
   */
  async retryWorkerOperation(workerFn, maxRetries = 3) {
    const result = await this.executeWithRetry(workerFn, {
      maxRetries,
      baseDelay: 200,
      maxDelay: 2000,
      exponentialBase: 2,
      jitterFactor: 0.1,
      operation: 'worker_operation',
      retryableErrors: [
        'Database operation timed out',
        'Worker terminated',
        'Worker error',
        'ECONNRESET'
      ]
    });

    if (!result.success) {
      throw new Error(`Worker operation failed after ${maxRetries + 1} attempts: ${result.error?.message}`);
    }

    return result.result;
  }

  /**
   * Classify database errors for better handling
   */
  classifyError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('sqlite_busy') || message.includes('database is locked')) {
      return DatabaseErrorType.DATABASE_LOCKED;
    }
    if (message.includes('deadlock')) {
      return DatabaseErrorType.TRANSACTION_DEADLOCK;
    }
    if (message.includes('connection') || message.includes('cantopen')) {
      return DatabaseErrorType.CONNECTION_FAILED;
    }
    if (message.includes('disk') || message.includes('no space')) {
      return DatabaseErrorType.DISK_FULL;
    }
    if (message.includes('corrupt') || message.includes('malformed')) {
      return DatabaseErrorType.CORRUPT_DATABASE;
    }
    if (message.includes('timeout')) {
      return DatabaseErrorType.WORKER_TIMEOUT;
    }
    if (message.includes('worker terminated')) {
      return DatabaseErrorType.WORKER_TERMINATED;
    }
    
    return DatabaseErrorType.UNKNOWN;
  }

  /**
   * Check if an error is retryable based on configuration
   */
  isRetryableError(error, retryableErrors) {
    const errorMessage = error.message.toLowerCase();
    const errorCode = this.getErrorCode(error);
    
    return retryableErrors.some(retryableError => {
      const pattern = retryableError.toLowerCase();
      return errorMessage.includes(pattern) || 
             (errorCode && errorCode.toString().toLowerCase().includes(pattern));
    });
  }

  /**
   * Safely extract error code from error object
   */
  getErrorCode(error) {
    if ('code' in error) {
      return error.code;
    }
    return undefined;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   * Uses exponential backoff formula: baseDelay * (exponentialBase ^ attemptNumber)
   * This provides progressively longer delays between retries to avoid overwhelming the system
   */
  calculateDelay(attempt, options) {
    // Exponential backoff: delay increases exponentially with each attempt
    const exponentialDelay = options.baseDelay * Math.pow(options.exponentialBase, attempt);
    const cappedDelay = Math.min(exponentialDelay, options.maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * options.jitterFactor * (Math.random() - 0.5);
    const finalDelay = Math.max(0, cappedDelay + jitter);
    
    return Math.round(finalDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update retry statistics
   */
  updateStats(operation, type) {
    if (!this.retryStats.has(operation)) {
      this.retryStats.set(operation, {
        totalAttempts: 0,
        successCount: 0,
        failureCount: 0
      });
    }

    const stats = this.retryStats.get(operation);
    
    switch (type) {
      case 'attempt':
        stats.totalAttempts++;
        break;
      case 'success':
        stats.successCount++;
        break;
      case 'failure':
        stats.failureCount++;
        stats.lastFailure = new Date();
        break;
    }
  }

  /**
   * Get retry statistics for monitoring
   */
  getRetryStats() {
    const result = new Map();
    
    for (const [operation, stats] of this.retryStats) {
      result.set(operation, {
        ...stats,
        successRate: stats.totalAttempts > 0 ? stats.successCount / stats.totalAttempts : 0
      });
    }
    
    return result;
  }

  /**
   * Clear retry statistics
   */
  clearStats() {
    this.retryStats.clear();
  }
}

// Singleton instance
const retryUtility = DatabaseRetryUtility.getInstance();

// Export convenience functions
module.exports = {
  DatabaseRetryUtility,
  DatabaseErrorType,
  retryUtility,
  executeWithRetry: retryUtility.executeWithRetry.bind(retryUtility),
  retryConnection: retryUtility.retryConnection.bind(retryUtility),
  retryTransaction: retryUtility.retryTransaction.bind(retryUtility),
  retryWorkerOperation: retryUtility.retryWorkerOperation.bind(retryUtility)
};