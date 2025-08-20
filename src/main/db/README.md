# PasteFlow Database Layer (TypeScript)

## Overview

The PasteFlow database layer provides a high‑performance SQLite storage stack with:

- Worker thread isolation for non‑blocking operations
- Optional connection pooling for concurrency scenarios
- Automatic retry logic for transient failures (SQLITE_BUSY/LOCKED, etc.)
- Strict TypeScript design and typed envelopes to the renderer
- Shared memory usage patterns for efficient data transfer
- In‑memory fallback mode when persistent storage fails

Notes:
- Legacy localStorage migration has been superseded by a safer in‑memory fallback; we no longer write to localStorage from the main process.

## Architecture

```
Renderer (React) → Main (src/main/main.ts, IPC) → DatabaseBridge → one of:
  • PasteFlowDatabase (better‑sqlite3, prepared statements, PRAGMAs)            // direct path
  • PooledDatabase (ConnectionPool: read/write split, metrics, cache)           // optional
  • AsyncDatabase → Database Worker (worker_threads; better‑sqlite3 underneath) // optional
```

## Core Components

### DatabaseBridge (database-bridge.ts)
- Entry point used by the main process
- Handles initialization with retry and automatic fallback to in‑memory DB
- Exposes async CRUD envelopes for workspaces, preferences, and instructions

### PasteFlowDatabase (database-implementation.ts)
- Core SQL logic using better‑sqlite3 with:
  - WAL mode, NORMAL sync, large cache, busy_timeout
  - Prepared statements for all CRUD operations
  - JSON-serialized state (per workspace)
- Provides typed operations and error classification

### AsyncDatabase + Worker (async-database.ts, database-worker.ts)
- Worker thread boundary for certain operations or future async tasks
- Message envelopes, operation timeouts, health checks, and restart logic
- Enhanced diagnostics (e.g., slow queries, stats events) posted to parent

### Optional Pooling
- connection-pool.ts, pooled-database.ts, pooled-database-bridge.ts, pool-config.ts
- Pool configuration presets for various workloads, with status diagnostics

### Utilities
- retry-utils.ts — executeWithRetry, retryTransaction, retryWorkerOperation
- shared-buffer-utils.ts — patterns for efficient memory transfer (kept minimal in current design)

## Database Schema

### workspaces
```sql
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  folder_path TEXT,
  state TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  last_accessed INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

### preferences
```sql
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

### instructions
```sql
CREATE TABLE instructions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

Indexes exist for common access paths (e.g., workspace name/last_accessed, preferences key, instruction name/updated_at).

## Usage

### Initialization (Main process)

TypeScript in [src/main/main.ts](src/main/main.ts) performs the bridge initialization with in‑memory fallback if persistent storage fails:

```ts
import { app } from 'electron';
import { DatabaseBridge } from './db/database-bridge';

let database: DatabaseBridge | null = null;

app.whenReady().then(async () => {
  try {
    database = new DatabaseBridge();
    await database.initialize(); // retries + safe fallback to ':memory:'
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    database = null; // triggers UI-level in-memory envelopes
  }
  // create BrowserWindow...
});
```

### IPC integration (Main → Renderer)

We expose TypeScript IPC envelopes under the following channels, implemented in [src/main/main.ts](src/main/main.ts):

- Workspaces:
  - '/workspace/list'
  - '/workspace/create'
  - '/workspace/load'
  - '/workspace/update'
  - '/workspace/delete'
  - '/workspace/rename'
  - '/workspace/touch'
- Preferences:
  - '/prefs/get'
  - '/prefs/set'
- Instructions:
  - '/instructions/list'
  - '/instructions/create'
  - '/instructions/update'
  - '/instructions/delete'

All envelopes return `{ success: boolean; data?: unknown; error?: string }`.

Renderer usage example:

```ts
// List workspaces (renderer)
const listRes = await window.electron.ipcRenderer.invoke('/workspace/list');
// Create workspace
await window.electron.ipcRenderer.invoke('/workspace/create', {
  name: 'My Project',
  folderPath: '/path/to/project',
  state: {}
});
// Preferences
const theme = await window.electron.ipcRenderer.invoke('/prefs/get', { key: 'theme' });
await window.electron.ipcRenderer.invoke('/prefs/set', { key: 'theme', value: 'dark' });
```

### TypeScript notes

- All database files are authored in TypeScript; the Electron main build compiles to CJS in `build/main`.
- The worker file [database-worker.ts](src/main/db/database-worker.ts) is loaded by worker_threads from the compiled output at runtime (packaging step ensures the JS file is co‑located).

## Key Features

### Worker Thread Isolation
- Database operations run off the main thread
- UI remains responsive during heavy operations
- Heartbeat, stats, and health checks implemented in the worker

### Connection Pooling (Optional)
- Pool presets for high load vs. standard usage in [pool-config.ts](src/main/db/pool-config.ts:1)
- Consider enabling when you introduce parallel heavy operations

### Retry + Robustness
- `executeWithRetry`, `retryTransaction`, and error classification for common SQLite codes
- Busy/locked handling with backoff
- Operation timeouts with diagnostics in the worker

### TypeScript Integration
- Strict types for envelopes and results
- JSON state serialization with predictable shape

## Performance Characteristics

- WAL mode with NORMAL sync and large cache
- Typical single-query latency <5–20ms, dependent on I/O and index coverage
- Bulk operations: wrap in explicit transactions for significant speedups
- Worker overhead is minimal compared to I/O

## Testing

Run the DB test suite:

```bash
# All database tests
npm test src/main/db/__tests__

# Specific test files
npm test src/main/db/__tests__/async-database-test.ts
npm test src/main/db/__tests__/database-bridge.test.ts
npm test src/main/db/__tests__/database-implementation.test.ts
npm test src/main/db/__tests__/connection-pool-test.ts

# Performance benchmarks
npm test src/main/db/__tests__/benchmarks.ts
```

## Fallback Behavior

If initialization fails after retries, [DatabaseBridge.initialize()](src/main/db/database-bridge.ts:48) falls back to an in‑memory DB (non‑persistent), allowing the app to remain functional for viewing/packing content without permanent storage.

## File Structure

```
src/main/db/
├── README.md
├── index.ts
├── database-bridge.ts
├── database-implementation.ts
├── database-worker.ts
├── async-database.ts
├── connection-pool.ts
├── pooled-database.ts
├── pooled-database-bridge.ts
├── pool-config.ts
├── retry-utils.ts
├── shared-buffer-utils.ts
└── __tests__/
```

## Error Handling

- Graceful in‑memory fallback when persistent DB fails
- Automatic retries for transient errors
- Typed error propagation to renderer envelopes
- Verbose diagnostics and stats from the worker

## Future Considerations

- [ ] Automatic backups and recovery
- [ ] Vacuum/auto‑maintenance scheduling
- [ ] Query planning improvements / additional indexes
- [ ] Schema versioning and migrations
- [ ] Export/import at DB layer (complementing UI "Pack")
- [ ] Performance metrics surfaced to diagnostics UI