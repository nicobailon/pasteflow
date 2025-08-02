const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Constants
const CACHE_TTL_MS = 300000; // 5 minutes in milliseconds

// Initialize database with SQLCipher
const db = new Database(workerData.dbPath);

// Enable SQLCipher encryption
if (workerData.encryptionKey) {
  db.pragma(`cipher = 'aes-256-cbc'`);
  db.pragma(`key = '${workerData.encryptionKey}'`);
  db.pragma('cipher_integrity_check = 1');
  db.pragma('cipher_memory_security = ON');
}

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

// Prepared statement cache
const statements = new Map();

// Message handler
parentPort.on('message', ({ id, method, params }) => {
  try {
    let result;
    
    switch (method) {
      case 'run':
        result = db.prepare(params.sql).run(...(params.params || []));
        break;
      
      case 'get':
        result = db.prepare(params.sql).get(...(params.params || []));
        break;
      
      case 'all':
        result = db.prepare(params.sql).all(...(params.params || []));
        break;
      
      case 'exec':
        db.exec(params.sql);
        result = null;
        break;
      
      case 'prepare':
        const stmt = db.prepare(params.sql);
        const stmtId = `stmt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        statements.set(stmtId, stmt);
        result = stmtId;
        break;
      
      case 'stmt_run':
        result = statements.get(params.stmtId).run(...params.params);
        break;
      
      case 'stmt_get':
        result = statements.get(params.stmtId).get(...params.params);
        break;
      
      case 'stmt_all':
        result = statements.get(params.stmtId).all(...params.params);
        break;
      
      case 'stmt_finalize':
        statements.delete(params.stmtId);
        result = null;
        break;
      
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});

// Periodic maintenance
setInterval(() => {
  try {
    // WAL checkpoint
    db.pragma('wal_checkpoint(TRUNCATE)');
    
    // Clean up old prepared statements
    const now = Date.now();
    for (const [id, stmt] of statements) {
      const timestamp = parseInt(id.split('_')[1]);
      if (now - timestamp > CACHE_TTL_MS) {
        statements.delete(id);
      }
    }
  } catch (error) {
    console.error('Maintenance error:', error);
  }
}, 60000); // Every minute