import { parentPort, workerData } from 'worker_threads';
import type BetterSqlite3 from 'better-sqlite3';
import * as crypto from 'crypto';
import { retryUtility } from './retry-utils';
import { getBetterSqlite3 } from './better-sqlite3-loader';

// Constants
const CACHE_TTL_MS = 300000; // 5 minutes in milliseconds
const MAX_OPERATION_TIME = 60000; // 1 minute max for any operation
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_CONSECUTIVE_ERRORS = 10;

// Error tracking
let consecutiveErrors = 0;
let lastErrorTime: number | null = null;
let operationCount = 0;
let startTime = Date.now();

// Utility to safely extract error messages
const toErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
// Initialize database with enhanced error handling
let db: BetterSqlite3.Database;
try {
  const BetterSqlite = getBetterSqlite3();
  db = new BetterSqlite(workerData.dbPath);
  console.log('Database worker: Connection established to', workerData.dbPath);
} catch (error: unknown) {
  console.error('Database worker: Failed to initialize database:', error);
  // Send initialization error to parent
  if (parentPort) {
    parentPort.postMessage({
      error: `Database initialization failed: ${toErrorMessage(error)}`,
      type: 'init_error'
    });
  }
  process.exit(1);
}

// Enable SQLCipher encryption with error handling
if (workerData.encryptionKey) {
  try {
    db.pragma(`cipher = 'aes-256-cbc'`);
    db.pragma(`key = '${workerData.encryptionKey}'`);
    db.pragma('cipher_integrity_check = 1');
    db.pragma('cipher_memory_security = ON');
    console.log('Database worker: Encryption enabled');
  } catch (error: unknown) {
    console.error('Database worker: Failed to enable encryption:', error);
    if (parentPort) {
      parentPort.postMessage({
        error: `Encryption setup failed: ${toErrorMessage(error)}`,
        type: 'encryption_error'
      });
    }
  }
}

// Performance settings with error handling
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');
  db.pragma('busy_timeout = 10000'); // 10 second busy timeout
  console.log('Database worker: Performance settings applied');
} catch (error) {
  console.error('Database worker: Failed to apply performance settings:', error);
}

// Enhanced prepared statement cache with cleanup
const statements = new Map();
const statementUsage = new Map();

// Function to clean up old statements
function cleanupStatements() {
  const now = Date.now();
  for (const [id, timestamp] of statementUsage) {
    if (now - timestamp > CACHE_TTL_MS) {
      try {
        statements.delete(id);
        statementUsage.delete(id);
      } catch (error) {
        console.warn('Database worker: Failed to cleanup statement:', error);
      }
    }
  }
}

// Function to handle errors consistently
function handleOperationError(error: unknown, operation: string, id: string | number) {
 consecutiveErrors++;
 lastErrorTime = Date.now();

 console.error(`Database worker: Operation '${operation}' failed:`, error);

 const message = toErrorMessage(error);
 const code = (error as any)?.code;

 // Enhanced error information
 const errorInfo = {
   message,
   code,
   operation,
   consecutiveErrors,
   operationCount,
   workerUptime: Date.now() - startTime
 };

 if (parentPort) {
   parentPort.postMessage({ id, error: message, errorInfo });
 }

 // If too many consecutive errors, suggest restart
 if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
   console.error('Database worker: Too many consecutive errors, worker may need restart');
   if (parentPort) {
     parentPort.postMessage({
       type: 'worker_degraded',
       consecutiveErrors,
       lastErrorTime
     });
   }
 }
}

// Function to handle successful operations
function handleOperationSuccess(result: unknown, operation: string, id: string | number) {
 consecutiveErrors = 0; // Reset error counter on success
 operationCount++;

 if (parentPort) {
   parentPort.postMessage({ id, result });
 }
}

// Enhanced message handler with timeout and error recovery
if (parentPort) {
  parentPort.on('message', ({ id, method, params }) => {
    // Set up operation timeout
    const operationTimeout = setTimeout(() => {
      handleOperationError(
        new Error(`Operation timed out after ${MAX_OPERATION_TIME}ms`),
        method,
        id
      );
    }, MAX_OPERATION_TIME);
    
    try {
      let result;
      const startTime = Date.now();
      
      switch (method) {
        case 'run':
          if (!params.sql) throw new Error('SQL query is required');
          result = db.prepare(params.sql).run(...(params.params || []));
          break;
        
        case 'get':
          if (!params.sql) throw new Error('SQL query is required');
          result = db.prepare(params.sql).get(...(params.params || []));
          break;
        
        case 'all':
          if (!params.sql) throw new Error('SQL query is required');
          result = db.prepare(params.sql).all(...(params.params || []));
          break;
        
        case 'exec':
          if (!params.sql) throw new Error('SQL query is required');
          db.exec(params.sql);
          result = null;
          break;
        
        case 'prepare':
          if (!params.sql) throw new Error('SQL query is required');
          const stmt = db.prepare(params.sql);
          const stmtId = `stmt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          statements.set(stmtId, stmt);
          statementUsage.set(stmtId, Date.now());
          result = stmtId;
          break;
        
        case 'stmt_run':
          if (!params.stmtId) throw new Error('Statement ID is required');
          const runStmt = statements.get(params.stmtId);
          if (!runStmt) throw new Error(`Statement not found: ${params.stmtId}`);
          statementUsage.set(params.stmtId, Date.now());
          result = runStmt.run(...(params.params || []));
          break;
        
        case 'stmt_get':
          if (!params.stmtId) throw new Error('Statement ID is required');
          const getStmt = statements.get(params.stmtId);
          if (!getStmt) throw new Error(`Statement not found: ${params.stmtId}`);
          statementUsage.set(params.stmtId, Date.now());
          result = getStmt.get(...(params.params || []));
          break;
        
        case 'stmt_all':
          if (!params.stmtId) throw new Error('Statement ID is required');
          const allStmt = statements.get(params.stmtId);
          if (!allStmt) throw new Error(`Statement not found: ${params.stmtId}`);
          statementUsage.set(params.stmtId, Date.now());
          result = allStmt.all(...(params.params || []));
          break;
        
        case 'stmt_finalize':
          if (!params.stmtId) throw new Error('Statement ID is required');
          statements.delete(params.stmtId);
          statementUsage.delete(params.stmtId);
          result = null;
          break;
        
        case 'health_check':
          // Simple health check query
          result = db.prepare('SELECT 1 as health').get();
          break;
        
        default:
          throw new Error(`Unknown method: ${method}`);
      }
      
      clearTimeout(operationTimeout);
      
      const executionTime = Date.now() - startTime;
      if (executionTime > 5000) { // Log slow queries
        console.warn(`Database worker: Slow operation '${method}' took ${executionTime}ms`);
      }
      
      handleOperationSuccess(result, method, id);
      
    } catch (error) {
      clearTimeout(operationTimeout);
      handleOperationError(error, method, id);
    }
  });
} else {
  console.error('Database worker: parentPort is not available');
  process.exit(1);
}

// Enhanced periodic maintenance
setInterval(() => {
  try {
    // WAL checkpoint with error handling
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (checkpointError) {
      console.warn('Database worker: WAL checkpoint failed:', checkpointError);
    }
    
    // Clean up old prepared statements
    cleanupStatements();
    
    // Log worker statistics
    const stats = {
      uptime: Date.now() - startTime,
      operationCount,
      consecutiveErrors,
      activeStatements: statements.size,
      lastErrorTime
    };
    
    console.log('Database worker stats:', stats);
    
    // Send stats to parent if requested
    if (parentPort) {
      parentPort.postMessage({
        type: 'worker_stats',
        stats
      });
    }
    
  } catch (error) {
    console.error('Database worker: Maintenance error:', error);
  }
}, 60000); // Every minute

// Health check interval
setInterval(() => {
  try {
    // Perform simple health check
    db.prepare('SELECT 1').get();
  } catch (error: unknown) {
    console.error('Database worker: Health check failed:', error);
    if (parentPort) {
      parentPort.postMessage({
        type: 'health_check_failed',
        error: toErrorMessage(error)
      });
    }
  }
}, HEALTH_CHECK_INTERVAL);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Database worker: Received SIGTERM, shutting down gracefully...');
  try {
    // Clean up statements
    statements.clear();
    statementUsage.clear();
    
    // Close database
    if (db) {
      db.close();
    }
    
    console.log('Database worker: Shutdown complete');
  } catch (error) {
    console.error('Database worker: Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Database worker: Received SIGINT, shutting down...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Database worker: Uncaught exception:', error);
  if (parentPort) {
    parentPort.postMessage({
      type: 'uncaught_exception',
      error: error.message,
      stack: error.stack
    });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Database worker: Unhandled rejection at:', promise, 'reason:', reason);
  if (parentPort) {
    parentPort.postMessage({
      type: 'unhandled_rejection',
      reason: reason?.toString(),
      promise: promise?.toString()
    });
  }
});

console.log('Database worker: Initialized successfully');
if (parentPort) {
  parentPort.postMessage({
    type: 'worker_ready',
    pid: process.pid,
    startTime
  });
}