# PasteFlow Database Layer

## Overview

The PasteFlow database layer provides a secure, high-performance SQLite-based storage solution with the following features:

- **SQLCipher encryption** for data-at-rest security
- **Worker thread isolation** for non-blocking operations
- **Zod validation** on all IPC channels
- **Rate limiting** to prevent abuse
- **Content deduplication** with compression
- **Comprehensive audit logging**

## Architecture

```
┌─────────────────────┐
│   Renderer Process  │
│  (React Frontend)   │
└──────────┬──────────┘
           │ IPC
┌──────────▼──────────┐
│   Secure IPC Layer  │
│  (Zod Validation)   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Database Manager   │
│   (Main Process)    │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Secure Database    │
│  (Encryption Keys)  │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│   Async Database    │
│  (Worker Threads)   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│   Database Worker   │
│  (SQLite/SQLCipher) │
└─────────────────────┘
```

## Usage

### Initialization

In your Electron main process:

```typescript
import { DatabaseManager } from './src/main/db/database-manager';

app.whenReady().then(async () => {
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  
  // Database is now ready for IPC calls
});
```

### Frontend Usage

From the renderer process:

```typescript
// List workspaces
const workspaces = await window.electron.invoke('/workspace/list');

// Create workspace
const newWorkspace = await window.electron.invoke('/workspace/create', {
  name: 'My Project',
  folderPath: '/path/to/project',
  state: { /* initial state */ }
});

// Save file content
await window.electron.invoke('/file/save', {
  workspaceId: workspace.id,
  filePath: '/src/app.ts',
  content: fileContent,
  tokenCount: 150
});
```

## Security Features

### Encryption

- Database encrypted with SQLCipher using AES-256
- Encryption keys stored in macOS Keychain
- Device-specific key derivation using PBKDF2
- Automatic key rotation support

### Access Control

- All IPC channels require Zod validation
- Rate limiting prevents abuse
- Origin verification on all requests
- Workspace-scoped file access

### Audit Trail

Critical operations are logged to the `audit_log` table:
- Workspace creation/deletion
- Preference changes
- File modifications

## Performance

Based on benchmarks:
- Database initialization: <100ms
- Simple queries: <5ms
- Complex queries: <50ms
- Supports 100+ concurrent operations
- File content deduplication saves ~60% storage

## Testing

Run the test suite:

```bash
# Unit tests
npm test src/main/db/__tests__/async-database.test.ts

# Security tests
npm test src/main/db/__tests__/security.test.ts

# Performance benchmarks
npx ts-node src/main/db/__tests__/benchmarks.ts
```

## Migration from localStorage

This database layer is designed to replace the existing localStorage implementation. Key improvements:

1. **No size limits** - localStorage is limited to 5-10MB
2. **Better performance** - Async operations don't block UI
3. **Security** - Encrypted storage with access control
4. **Reliability** - ACID transactions, proper error handling
5. **Scalability** - Handles large codebases efficiently

## File Structure

```
src/main/db/
├── async-database.ts      # Worker thread wrapper
├── database-worker.js     # SQLite worker implementation
├── secure-database.ts     # Encryption layer
├── database-manager.ts    # Main process integration
├── schema.sql            # Database schema
└── __tests__/            # Test suite
    ├── async-database.test.ts
    ├── security.test.ts
    └── benchmarks.ts

src/main/ipc/
├── secure-ipc.ts         # IPC validation layer
├── schemas.ts            # Zod schemas
└── index.ts              # Exports
```

## Future Enhancements

- [ ] Automatic backups
- [ ] Import/export functionality
- [ ] Migration tools from v1
- [ ] Cloud sync support
- [ ] Advanced search capabilities