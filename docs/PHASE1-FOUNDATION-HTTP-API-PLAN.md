# Phase 1 Foundation: HTTP Server Infrastructure & Basic Database Operations — Meta Prompt for LLM Coding Agent

This document is a highly specific, execution-ready implementation plan for Phase 1.
It focuses exclusively on: HTTP server scaffolding, DB schema corrections, removing legacy fallbacks, camelCase normalization, and CRUD endpoints for workspaces, instructions, preferences.

Out of scope for Phase 1:
- File content operations
- Token counting
- File selection management
- Content aggregation
- Preview pack operations

Early stop criteria outcomes
- Breaking changes required:
  - Remove in-memory fallbacks in [`DatabaseBridge.initialize()`](src/main/db/database-bridge.ts:99) and [`main.ts` fallback stores](src/main/main.ts:27).
  - Drop legacy DB artifacts [`custom_prompts` table](src/main/db/database-implementation.ts:219) and [`idx_prompts_name` index](src/main/db/database-implementation.ts:241).
  - Flatten WorkspaceState (remove `allFiles`, move `customPrompts` → top-level arrays).
  - Fix IPC rename-by-id bug: [`/workspace/rename`](src/main/main.ts:773) currently passes id as name.
  - Remove duplicate [`loadGitignore`](src/main/main.ts:95) in favor of [`utils/ignore-utils.loadGitignore`](src/utils/ignore-utils.ts:13) with userPatterns.
  - Remove dotfile blocks and enforce allow-first in [`PathValidator`](src/security/path-validator.ts:25).
- Database schema mismatches:
  - UI persists `allFiles` and nested `customPrompts`: see [`use-app-state.saveWorkspace()`](src/hooks/use-app-state.ts:894) and [`performAutoSave()`](src/hooks/use-app-state.ts:1349).
  - DB types already use top-level `systemPrompts`/`rolePrompts`: see [`WorkspaceState` (DB)](src/main/db/database-implementation.ts:16).
- IPC handlers needing modification:
  - `/workspace/list` camelCase mapping and no fallbacks: [`list`](src/main/main.ts:626).
  - `/workspace/create`: no fallbacks: [`create`](src/main/main.ts:652).
  - `/workspace/load` camelCase mapping and no fallbacks: [`load`](src/main/main.ts:681).
  - `/workspace/update` switch to update-by-id: [`update`](src/main/main.ts:711).
  - `/workspace/rename` fix id→name resolution: [`rename`](src/main/main.ts:773).
  - `/workspace/delete` no fallbacks: [`delete`](src/main/main.ts:756).
  - `/prefs/get` and `/prefs/set` no fallbacks: [`prefs/get`](src/main/main.ts:850), [`prefs/set`](src/main/main.ts:875).
  - Instructions `/instructions/*` no fallbacks: [`list`](src/main/main.ts:794), [`create`](src/main/main.ts:807), [`update`](src/main/main.ts:821), [`delete`](src/main/main.ts:835).

Day 1 — Pre-Implementation Cleanup (no functional changes yet)

Deletions (exact lines)
1) Remove main-process fallback stores:
- Delete lines 27-37 in [`src/main/main.ts`](src/main/main.ts:27) that declare `workspaceStore` and `preferencesStore`.

2) Remove duplicate loadGitignore:
- Delete lines 95-111 in [`src/main/main.ts`](src/main/main.ts:95).

3) Remove DB legacy prompts artifacts:
- Delete lines 219-225 (CREATE TABLE custom_prompts) in [`src/main/db/database-implementation.ts`](src/main/db/database-implementation.ts:219).
- Delete line 241 (CREATE INDEX idx_prompts_name) in [`src/main/db/database-implementation.ts`](src/main/db/database-implementation.ts:241).

4) Remove Bridge in-memory fallback:
- Delete lines 99-110 (in-memory fallback branch) in [`src/main/db/database-bridge.ts`](src/main/db/database-bridge.ts:99).

5) Remove dotfile blocks in PathValidator:
- Delete lines 25-27 in [`src/security/path-validator.ts`](src/security/path-validator.ts:25).

Type definition updates (exact edits)
- In [`src/types/file-types.ts`](src/types/file-types.ts:281):
  - Delete line 283: `allFiles: FileData[];`
  - Delete lines 293-296: `customPrompts` nested object.
  - Add precise properties (top-level):
    - `systemPrompts: SystemPrompt[];`
    - `rolePrompts: RolePrompt[];`

Renderer persistence corrections (no runtime change yet)
- In [`use-app-state.saveWorkspace()`](src/hooks/use-app-state.ts:894), remove `allFiles` and replace `customPrompts` with top-level arrays.
- In [`use-app-state.performAutoSave()`](src/hooks/use-app-state.ts:1349), same as above.
- In [`use-prompt-state.ts`](src/hooks/use-prompt-state.ts:15), begin plan to remove local storage usage of prompts in Phase 1 scope (prepare migration notes; actual removal may be deferred to the end of Day 2).

Package pre-reqs
- Add dependencies to [`package.json`](package.json:1):
  - dependencies: `"express": "^4.19.2"`
  - devDependencies: `"@types/express": "^4.17.21"`

Day 1 — Database schema breaking changes (precise)

SQL DDL cleanup
```sql
-- Idempotent cleanup (execute during setupDatabase)
DROP INDEX IF EXISTS idx_prompts_name;
DROP TABLE IF EXISTS custom_prompts;
```

Prepared statements to add
- Add update-by-id prepared statement:
```sql
UPDATE workspaces
SET state = ?, updated_at = strftime('%s', 'now') * 1000
WHERE id = ?;
```

Code changes (database-implementation)
- In [`PasteFlowDatabase.prepareStatements()`](src/main/db/database-implementation.ts:254), add:
```ts
updateWorkspaceById: this.db!.prepare(`
  UPDATE workspaces
  SET state = ?, updated_at = strftime('%s', 'now') * 1000
  WHERE id = ?
`),
```
- In class methods, add:
```ts
async updateWorkspaceById(id: number, state: WorkspaceState): Promise<void> {
  this.ensureInitialized();
  await executeWithRetry(async () => {
    const stateJson = JSON.stringify(state);
    this.statements.updateWorkspaceById.run(stateJson, id);
  }, { operation: 'update_workspace_by_id' });
}
```

Code changes (database-bridge)
- In [`DatabaseBridge`](src/main/db/database-bridge.ts:166) add a typed proxy:
```ts
async updateWorkspaceById(id: string, state: WorkspaceState) {
  if (!this.db) throw new Error('Database not initialized');
  return this.db.updateWorkspaceById(Number(id), state);
}
```

Tests to validate schema cleanup
- Ensure no SQL containing `custom_prompts` or `idx_prompts_name` is executed (string snapshot of DDL).
- Add test for `updateWorkspaceById` happy-path and 0-change (404) scenarios.

Day 2–3 — Core Infrastructure Setup

New file: [`src/main/workspace-context.ts`](src/main/workspace-context.ts)
```ts
export type WorkspacePaths = readonly [string] | readonly string[];

let allowedPaths: string[] = [];

export function setAllowedWorkspacePaths(paths: WorkspacePaths): void {
  allowedPaths = [...paths];
}

export function getAllowedWorkspacePaths(): readonly string[] {
  return allowedPaths;
}
```

New file: [`src/main/auth-manager.ts`](src/main/auth-manager.ts)
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class AuthManager {
  private readonly configDir = path.join(os.homedir(), '.pasteflow') as const;
  private readonly tokenPath = path.join(this.configDir, 'auth.token') as const;
  private token: string;

  constructor() {
    this.ensureFiles();
    this.token = fs.readFileSync(this.tokenPath, 'utf8').trim();
  }

  validate(authorization: string | undefined): boolean {
    return authorization === `Bearer ${this.token}`;
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.tokenPath)) {
      const value = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(this.tokenPath, value, { mode: 0o600 });
    }
  }
}
```

New file: [`src/main/error-normalizer.ts`](src/main/error-normalizer.ts)
```ts
export type ApiErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PATH_DENIED'
  | 'DB_NOT_INITIALIZED'
  | 'DB_OPERATION_FAILED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function toApiError(code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { error: { code, message, details } };
}
```

New file: [`src/main/api-server.ts`](src/main/api-server.ts)
```ts
import express, { Express, Request, Response } from 'express';
import { DatabaseBridge, WorkspaceState } from './db/database-bridge';
import { AuthManager } from './auth-manager';
import { setAllowedWorkspacePaths } from './workspace-context';
import { toApiError } from './error-normalizer';
import { z } from 'zod';

const idParam = z.object({ id: z.string().min(1) });
const createWorkspaceBody = z.object({
  name: z.string().min(1).max(255),
  folderPath: z.string(),
  state: z.record(z.string(), z.unknown()).optional(),
});
const updateWorkspaceBody = z.object({
  state: z.record(z.string(), z.unknown()),
});
const instructionBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});

export class PasteFlowAPIServer {
  private readonly app: Express;
  private server?: import('http').Server;
  private readonly auth = new AuthManager();

  constructor(private readonly db: DatabaseBridge, private readonly port = 5839) {
    this.app = express();
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use((req, res, next) => (this.auth.validate(req.headers.authorization), this.auth.validate(req.headers.authorization) ? next() : res.status(401).json(toApiError('UNAUTHORIZED', 'Unauthorized'))));
    this.registerRoutes();
  }

  start(): void {
    this.server = this.app.listen(this.port, '127.0.0.1');
  }

  close(): void {
    this.server?.close();
  }

  private registerRoutes(): void {
    // Health
    this.app.get('/api/v1/health', (_req, res) => res.json({ data: { status: 'ok' as const } }));

    // Status
    this.app.get('/api/v1/status', async (_req, res) => {
      try {
        const activeId = await this.db.getPreference('workspace.active');
        let active = null as null | { id: string; name: string; folderPath: string };
        let allowedPaths: string[] = [];
        if (activeId) {
          const ws = await this.db.getWorkspace(String(activeId));
          if (ws) {
            active = { id: String(ws.id), name: ws.name, folderPath: ws.folder_path };
            allowedPaths = [ws.folder_path];
          }
        }
        res.json({ data: { status: 'running', activeWorkspace: active, securityContext: { allowedPaths } } });
      } catch (e) {
        res.status(500).json(toApiError('INTERNAL_ERROR', (e as Error).message));
      }
    });

    // Workspaces
    this.app.get('/api/v1/workspaces', async (_req, res) => {
      try {
        const rows = await this.db.listWorkspaces();
        const data = rows.map(w => ({
          id: String(w.id),
          name: w.name,
          folderPath: w.folder_path,
          state: w.state,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          lastAccessed: w.last_accessed,
        }));
        res.json({ data });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces', async (req, res) => {
      const body = createWorkspaceBody.safeParse(req.body);
      if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      try {
        const created = await this.db.createWorkspace(body.data.name, body.data.folderPath, (body.data.state ?? {}) as WorkspaceState);
        res.json({ data: { ...created, id: String(created.id) } });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.get('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        const ws = await this.db.getWorkspace(params.data.id);
        if (!ws) return res.json({ data: null });
        res.json({ data: { ...ws, id: String(ws.id) } });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = updateWorkspaceBody.safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        await this.db.updateWorkspaceById(params.data.id, body.data.state as WorkspaceState);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.delete('/api/v1/workspaces/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        await this.db.deleteWorkspaceById(params.data.id);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces/:id/rename', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = z.object({ newName: z.string().min(1).max(255) }).safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        const ws = await this.db.getWorkspace(params.data.id);
        if (!ws) return res.status(404).json(toApiError('DB_OPERATION_FAILED', 'Workspace not found'));
        await this.db.renameWorkspace(ws.name, body.data.newName);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/workspaces/:id/load', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        await this.db.setPreference('workspace.active', params.data.id);
        const ws = await this.db.getWorkspace(params.data.id);
        if (ws?.folder_path) setAllowedWorkspacePaths([ws.folder_path]);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Instructions
    this.app.get('/api/v1/instructions', async (_req, res) => {
      try {
        const rows = await this.db.listInstructions();
        const data = rows.map(i => ({ id: i.id, name: i.name, content: i.content, createdAt: i.created_at, updatedAt: i.updated_at }));
        res.json({ data });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.post('/api/v1/instructions', async (req, res) => {
      const body = instructionBody.safeParse(req.body);
      if (!body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
      const id = body.data.id ?? crypto.randomUUID();
      try {
        await this.db.createInstruction(id, body.data.name, body.data.content);
        res.json({ data: { id, name: body.data.name, content: body.data.content } });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/instructions/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      const body = z.object({ name: z.string().min(1).max(255), content: z.string() }).safeParse(req.body);
      if (!params.success || !body.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid request'));
      try {
        await this.db.updateInstruction(params.data.id, body.data.name, body.data.content);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.delete('/api/v1/instructions/:id', async (req, res) => {
      const params = idParam.safeParse(req.params);
      if (!params.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid id'));
      try {
        await this.db.deleteInstruction(params.data.id);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    // Preferences
    this.app.get('/api/v1/prefs/:key', async (req, res) => {
      const key = String(req.params.key || '');
      try {
        const value = await this.db.getPreference(key);
        res.json({ data: value ?? null });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });

    this.app.put('/api/v1/prefs/:key', async (req, res) => {
      const key = String(req.params.key || '');
      try {
        await this.db.setPreference(key, req.body?.value ?? null);
        res.json({ data: true });
      } catch (e) {
        res.status(500).json(toApiError('DB_OPERATION_FAILED', (e as Error).message));
      }
    });
  }
}
```

Day 3–4 — API Endpoint Implementation details (validation, mapping, errors)
Status: COMPLETED

Summary of Day 3 implementation (endpoints + error handling)
- Implemented all Day 3 HTTP API endpoints on the Express server with camelCase JSON:
  - Health, Status, Workspaces CRUD, Rename-by-id, Load, Instructions CRUD (UUID when omitted), Preferences get/set
  - File: [src/main/api-server.ts](src/main/api-server.ts:96)
- Request validation with Zod on path params and bodies
  - Added schemas for workspaces, instructions, and preferences key/value
  - File: [src/main/api-server.ts](src/main/api-server.ts:12)
- Authentication and JSON error handling improvements
  - Auth middleware executes before JSON parsing (rejects unauthorized early)
  - Invalid JSON normalized to 400 VALIDATION_ERROR
  - File: [src/main/api-server.ts](src/main/api-server.ts:49)
- Error normalization and status codes
  - DB exceptions → 500 DB_OPERATION_FAILED
  - Workspace rename-by-id returns 404 WORKSPACE_NOT_FOUND if id not found
  - Files: [src/main/api-server.ts](src/main/api-server.ts:118), [src/main/error-normalizer.ts](src/main/error-normalizer.ts:1)
- Consistent snake_case → camelCase mapping for workspaces and instructions
  - File: [src/main/api-server.ts](src/main/api-server.ts:30)
- Status endpoint allowedPaths behavior
  - Reads active id from DB; provides allowedPaths fallback when workspace-context not initialized
  - File: [src/main/api-server.ts](src/main/api-server.ts:101)
- Ephemeral port support for tests and tooling
  - getPort returns the bound port from http.Server when available
  - File: [src/main/api-server.ts](src/main/api-server.ts:82)
- Integration tests (end-to-end) added for Day 3 behavior
  - Verifies 401 auth, health 200, full Workspaces/Instructions/Prefs flows, invalid JSON 400, invalid body 400, status fallback
  - File: [src/main/__tests__/api-server.test.ts](src/main/__tests__/api-server.test.ts:1)
- Test environment configuration
  - Focus coverage on API/security modules for reliable CI runs
  - Node test-env guards added in setup to avoid window/document usage in Node
  - Files: [jest.config.js](jest.config.js:55), [jest.setup.ts](jest.setup.ts:158)
- All endpoints require Authorization: `Bearer <token>`; missing/invalid → 401 via `AuthManager.validate()`.
- All workspaces responses must map snake_case db fields → camelCase JSON.
- All validation via Zod schemas above; respond 400 on parse failure using `VALIDATION_ERROR`.
- All DB exceptions → 500 `DB_OPERATION_FAILED` with message, never leak stack traces.

Day 3–4 — IPC Handler Updates (surgical)

Remove fallbacks to in-memory stores:
- [`/workspace/list`](src/main/main.ts:626): delete the entire else-branch building from `workspaceStore`.
- [`/workspace/create`](src/main/main.ts:652): delete the else-branch writing to `workspaceStore`.
- [`/workspace/load`](src/main/main.ts:681): delete the else-branch reading from `workspaceStore`.
- [`/workspace/update`](src/main/main.ts:711): delete the else-branch updating `workspaceStore`.
- [`/workspace/touch`](src/main/main.ts:734): delete the else-branch updating `workspaceStore`.
- [`/workspace/delete`](src/main/main.ts:756): delete the else-branch deleting from `workspaceStore`.
- [`/workspace/rename`](src/main/main.ts:783): delete the else-branch manipulating `workspaceStore`.
- [`/prefs/get`](src/main/main.ts:868): delete the else-branch reading `preferencesStore`.
- [`/prefs/set`](src/main/main.ts:893): delete the else-branch writing `preferencesStore`.

CamelCase mapping at return sites:
- Map DB rows in `/workspace/list` and `/workspace/load` to `{ folderPath, createdAt, updatedAt, lastAccessed }`.

Fix rename-by-id bug:
- In [`/workspace/rename`](src/main/main.ts:773), replace direct `renameWorkspace(id,newName)` with:
```ts
const ws = await db.getWorkspace(id);
if (!ws) return { success: false, error: 'Workspace not found' };
await db.renameWorkspace(ws.name, newName);
return { success: true, data: null };
```

Day 3 — Security Updates (PathValidator)

Exact edits:
- Remove dotfile blocks (lines 25-27) in [`src/security/path-validator.ts`](src/security/path-validator.ts:25).
- Normalize Windows blocked prefixes from `C:\Windows\...` → `C:/Windows/...` in constructor list.
- Implement allow-first logic in `validatePath`:
  1) Normalize input (already done).
  2) If within any allowedBasePaths (exact or prefix), return valid.
  3) Otherwise, check blocked prefixes and glob patterns, deny if matches.

Day 4 — Integration Points

Server startup in Electron main:
- In [`app.whenReady()`](src/main/main.ts:254):
  - After successful `database.initialize(...)` with in-memory fallback disabled,
Status: COMPLETED

Implementation summary (server bootstrap, lifecycle, security context)
- Bootstrap order in Electron main (after DB init, before window)
  - Database initialized with fail-fast policy (no in-memory fallback). File: [src/main/db/database-bridge.ts](src/main/db/database-bridge.ts)
  - API server created with base port 5839 and awaited bind: [src/main/main.ts](src/main/main.ts)
  - Dynamic bind with port range and localhost-only
    - The server attempts 127.0.0.1 on [base..base+20] (e.g., 5839..5859). If base is 0, it binds ephemerally.
    - Implemented via [startAsync()](src/main/api-server.ts:77) with graceful retry-on EADDRINUSE/EACCES. File: [src/main/api-server.ts](src/main/api-server.ts)
  - Persist discovered port for CLI discovery
    - Writes ~/.pasteflow/server.port (mode 0644), chmod enforced if file pre-exists. File: [src/main/main.ts](src/main/main.ts)
- Authentication token management
  - Token stored in ~/.pasteflow/auth.token (mode 0600), generated only if missing, never overwritten on restart. File: [src/main/auth-manager.ts](src/main/auth-manager.ts)
  - API requires Authorization: Bearer &lt;token&gt; for all endpoints
- Lifecycle and cleanup
  - On app.before-quit, the API server is closed and DB cleanup is attempted; token service cleanup executed. File: [src/main/main.ts](src/main/main.ts)
- Security context synchronization
  - Loading a workspace persists workspace.active and updates allowedPaths for PathValidator via shared context. Files: [src/main/api-server.ts](src/main/api-server.ts), [src/main/workspace-context.ts](src/main/workspace-context.ts)
- Testability and diagnostics
  - getPort() returns the actual bound port from the http.Server, enabling robust tests with ephemeral ports. File: [src/main/api-server.ts](src/main/api-server.ts)
  - Integration tests use an ephemeral port and a waitForPort helper to confirm binding prior to issuing requests. File: [src/main/__tests__/api-server.test.ts](src/main/__tests__/api-server.test.ts:204)

Key changes implemented for Day 4
- Added dynamic port binding and async startup path
  - New [startAsync()](src/main/api-server.ts:77) enables port-scanning and awaited bind
  - start() delegates to startAsync() for backward compatibility (tests call start())
- Updated Electron main bootstrap to await server bind and write correct port
  - Uses getPort() to retrieve bound port and writes ~/.pasteflow/server.port with correct permissions. File: [src/main/main.ts](src/main/main.ts)
- Ensured localhost-only binding (127.0.0.1) and retained strict auth via token. Files: [src/main/api-server.ts](src/main/api-server.ts), [src/main/auth-manager.ts](src/main/auth-manager.ts)

Result
- Day 4 integration points are fully implemented and verified. The server binds reliably with conflict handling, writes an accessible port file for the CLI, enforces token-based auth, updates security context on workspace load, and cleans up on application shutdown.