# PasteFlow Database Layer

## Overview

The PasteFlow database layer provides a high-performance SQLite-based storage solution with the following features:

- **Worker thread isolation** for non-blocking database operations
- **Connection pooling** for improved concurrent access
- **Automatic retry logic** for transient failures
- **TypeScript-first design** with strict type safety
- **Shared memory buffers** for efficient data transfer
- **Migration from localStorage** for backward compatibility

## Architecture

```
┌─────────────────────┐
│   Renderer Process  │
│  (React Frontend)   │
└──────────┬──────────┘
           │ IPC
┌──────────▼──────────┐
│    Main Process     │
│   (main.js IPC)     │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Database Bridge    │
│  (Initialization)   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Pooled Database     │
│ (Connection Pool)   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Async Database     │
│  (Worker Threads)   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Database Worker    │
│  (better-sqlite3)   │
└─────────────────────┘
```

## Core Components

### DatabaseBridge (`database-bridge.ts`)
- Entry point for database operations
- Handles initialization and fallback to legacy localStorage
- Manages the transition between storage backends

### DatabaseImplementation (`database-implementation.ts`)
- Core database logic and SQL operations
- Workspace management (CRUD operations)
- Preferences and instructions storage
- Prepared statements for performance

### AsyncDatabase (`async-database.ts`)
- Worker thread wrapper for non-blocking operations
- Message passing between main and worker threads
- Error handling and promise resolution

### DatabaseWorker (`database-worker.ts`)
- Runs in a separate worker thread
- Direct SQLite operations via better-sqlite3
- Handles all database queries and mutations

### Connection Pooling
- `connection-pool.ts` - Pool management logic
- `pooled-database.ts` - Pooled database wrapper
- `pooled-database-bridge.ts` - Bridge with connection pooling
- `pool-config.ts` - Pool configuration settings

### Utilities
- `retry-utils.ts` - Retry logic for transient failures
- `shared-buffer-utils.ts` - Efficient data transfer using SharedArrayBuffer

## Database Schema

### Workspaces Table
```sql
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  folderPath TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL
)
```

### Preferences Table
```sql
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### Instructions Table
```sql
CREATE TABLE instructions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

## Usage

### Initialization

In the Electron main process (`main.js`):

```javascript
const { DatabaseBridge } = require('./src/main/db/database-bridge');

app.whenReady().then(async () => {
  const database = new DatabaseBridge();
  await database.initialize();
  
  // Database is now ready for operations
});
```

### IPC Integration

The main process handles IPC calls for database operations:

```javascript
// List workspaces
ipcMain.handle('list-workspaces', async () => {
  return await database.listWorkspaces();
});

// Create workspace
ipcMain.handle('create-workspace', async (event, name, folderPath, state) => {
  return await database.createWorkspace(name, folderPath, state);
});

// Get/Set preferences
ipcMain.handle('get-preference', async (event, key) => {
  return await database.getPreference(key);
});
```

### Frontend Usage

From the renderer process:

```typescript
// List workspaces
const workspaces = await window.electron.listWorkspaces();

// Create workspace
const newWorkspace = await window.electron.createWorkspace(
  'My Project',
  '/path/to/project',
  { /* workspace state */ }
);

// Manage preferences
await window.electron.setPreference('theme', 'dark');
const theme = await window.electron.getPreference('theme');
```

## Key Features

### Worker Thread Isolation
- Database operations run in a separate thread
- Prevents blocking the main Electron process
- Maintains UI responsiveness during heavy operations

### Connection Pooling
- Configurable pool size (default: 5 connections)
- Automatic connection management
- Improved performance for concurrent operations

### Retry Logic
- Automatic retry for SQLITE_BUSY errors
- Configurable retry attempts and delays
- Graceful handling of database locks

### TypeScript Integration
- Full TypeScript support with strict typing
- Type-safe database operations
- Comprehensive type definitions for all data structures

## Performance Characteristics

Based on benchmarks:
- Database initialization: ~50-100ms
- Simple queries: <5ms
- Complex queries: <20ms
- Bulk operations: Optimized with transactions
- Worker thread overhead: Minimal (<1ms)

## Testing

Run the test suite:

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

## Migration from localStorage

The database layer seamlessly migrates from the legacy localStorage implementation:

1. **Automatic detection** - Checks for existing localStorage data
2. **Transparent migration** - Migrates data on first run
3. **Backward compatibility** - Falls back to localStorage if needed
4. **No data loss** - Preserves all existing workspaces and preferences

### Benefits over localStorage:
- **No size limits** - localStorage is limited to 5-10MB
- **Better performance** - Async operations don't block UI
- **Concurrency** - Multiple operations can run in parallel
- **Reliability** - ACID transactions, proper error handling
- **Scalability** - Handles large codebases efficiently

## File Structure

```
src/main/db/
├── README.md                      # This file
├── index.ts                       # Module exports
├── database-bridge.ts             # Main entry point
├── database-implementation.ts     # Core database logic
├── database-worker.ts             # Worker thread implementation
├── async-database.ts              # Worker thread wrapper
├── connection-pool.ts             # Connection pool management
├── pooled-database.ts             # Pooled database wrapper
├── pooled-database-bridge.ts      # Bridge with pooling
├── pool-config.ts                 # Pool configuration
├── retry-utils.ts                 # Retry logic utilities
├── shared-buffer-utils.ts         # SharedArrayBuffer utilities
└── __tests__/                     # Test suite
    ├── async-database-test.ts
    ├── database-bridge.test.ts
    ├── database-implementation.test.ts
    ├── connection-pool-test.ts
    └── benchmarks.ts
```

## Error Handling

The database layer implements comprehensive error handling:

- **Graceful fallback** - Falls back to localStorage on initialization failure
- **Retry logic** - Automatic retry for transient errors
- **Error propagation** - Errors are properly propagated to the UI
- **Logging** - Detailed error logging for debugging

## Future Considerations

- [ ] Automatic backups and recovery
- [ ] Database vacuuming and optimization
- [ ] Advanced query optimization
- [ ] Database migration versioning
- [ ] Export/import functionality
- [ ] Performance monitoring and metrics