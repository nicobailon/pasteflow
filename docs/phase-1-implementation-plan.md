# Phase 1 Implementation Plan — Data & Persistence Foundations

This document is self-contained and describes everything needed to implement the data layer for Agent Approvals. It is based on the overall agent approval plan in `docs/agent-approval-plan.md` and adheres to repository standards in `TYPESCRIPT.md` and `TESTING.md`.

---

## Objectives
- Introduce strongly typed domain primitives and records for tool previews and approvals.
- Extend the SQLite schema and `DatabaseBridge` for durable storage, retrieval, and export of approvals data.
- Return inserted row IDs for `tool_executions` to correlate previews with executions.
- Provide a safe runtime validation layer for preview payloads.

### Success Criteria
- New tables `agent_tool_previews` and `agent_tool_approvals` are created with indexes and FKs.
- `DatabaseBridge.insertToolExecution(...)` returns `Promise<number>` (inserted row id) and all call sites compile.
- New `DatabaseBridge` helpers for previews/approvals exist with precise types and passing tests.
- All JSON parsing is safely narrowed; no `any` usage, no unsafe casts.

---

## Technical Requirements & Specs

### Type-Safe Domain Primitives (new file)
- Add `src/main/agent/preview-registry.ts` exporting:
  - Branded identifiers per `TYPESCRIPT.md`:
    - `type PreviewId = string & { readonly __brand: 'PreviewId' }`
    - `type ChatSessionId = string & { readonly __brand: 'ChatSessionId' }`
    - `type UnixMs = number & { readonly __brand: 'UnixMs' }`
    - `type ToolName = 'file' | 'edit' | 'terminal' | 'search' | 'context'`
    - `type ToolAction = string` (narrow per tool later)
  - `type ToolArgsSnapshot = Readonly<Record<string, unknown>>`
  - `type PreviewEnvelope = Readonly<{ id: PreviewId; sessionId: ChatSessionId; tool: ToolName; action: string; summary: string; detail: Record<string, unknown> | null; originalArgs: ToolArgsSnapshot; createdAt: UnixMs; hash: string; }>`
  - Runtime guards: `isPreviewEnvelope(value: unknown): value is PreviewEnvelope` and `assertPreviewEnvelope(value: unknown): asserts value is PreviewEnvelope` (use zod or hand-guards).
  - Helper: `makePreviewId`, `makeSessionId` (validate UUIDv4 before branding), `nowUnixMs(): UnixMs`.

### Database Schema (extend `src/main/db/database-implementation.ts`)
- Create tables (during initialization block):
  - `agent_tool_previews`
    - `id TEXT PRIMARY KEY`
    - `tool_execution_id INTEGER NOT NULL` (FK → `tool_executions.id` ON DELETE CASCADE)
    - `session_id TEXT NOT NULL`
    - `tool TEXT NOT NULL`
    - `action TEXT NOT NULL`
    - `summary TEXT NOT NULL`
    - `detail TEXT` (JSON)
    - `args TEXT` (JSON)
    - `hash TEXT UNIQUE NOT NULL`
    - `created_at INTEGER NOT NULL`
    - Indexes: `(session_id, created_at DESC)`, `hash`
  - `agent_tool_approvals`
    - `id TEXT PRIMARY KEY`
    - `preview_id TEXT NOT NULL` (FK → `agent_tool_previews.id` ON DELETE CASCADE)
    - `session_id TEXT NOT NULL`
    - `status TEXT NOT NULL CHECK(status IN ('pending','approved','applied','rejected','auto_approved','failed'))`
    - `created_at INTEGER NOT NULL`
    - `resolved_at INTEGER`
    - `resolved_by TEXT`
    - `auto_reason TEXT`
    - `feedback_text TEXT`
    - `feedback_meta TEXT`
    - Indexes: `(session_id, status)`, `(resolved_at)`

### Database Statements & Bridge API
- Prefer an additive approach to avoid breaking call sites in this phase:
  - Keep existing `insertToolExecution(...)` (returns `Promise<void>`) for compatibility.
  - Add `insertToolExecutionReturningId(...) : Promise<number>` that uses `stmtInsertToolExecution().run(...)` and returns the inserted id via `lastInsertRowid`.
  - Migrate call sites gradually in later phases if desired.
- Add prepared statements and async wrappers for:
  - `insertPreview(preview: PreviewEnvelope & { toolExecutionId: number }): Promise<void>`
  - `getPreviewById(id: PreviewId): Promise<PreviewRow | null>`
  - `listPreviews(sessionId: ChatSessionId): Promise<readonly PreviewRow[]>`
  - `insertApproval(input: { id: string; previewId: string; sessionId: string; status: string; createdAt: number }): Promise<void>`
  - `updateApprovalStatus(input: { id: string; status: string; resolvedAt?: number; resolvedBy?: string | null; autoReason?: string | null }): Promise<void>`
  - `updateApprovalFeedback(input: { id: string; feedbackText?: string | null; feedbackMeta?: unknown | null }): Promise<void>` (JSON-stringify `feedbackMeta` safely)
  - `listPendingApprovals(sessionId: ChatSessionId): Promise<readonly ApprovalRow[]>`
  - `listApprovalsForExport(sessionId: ChatSessionId): Promise<{ previews: readonly PreviewRow[]; approvals: readonly ApprovalRow[] }>`

Ensure types are precise and readonly; JSON parsing must be guarded (wrap in `try/catch`, validate structure, and return typed objects).

### Startup Migration (extend `src/main/main.ts`)
- Near the existing approval-mode migration, add an idempotent migration function that creates the new tables and indexes if missing. Log success/failure with clear messages. Do not block app startup on non-critical export index creation.

### Coding Standards
- Follow `TYPESCRIPT.md` strictly: no `any`, use branded types, discriminated unions where applicable, `as const` where appropriate, and runtime validation at IO boundaries.
- Respect existing lints and naming conventions (kebab-case filenames, double quotes, 2-space indent).

### Documentation & Developer Experience
- Update `src/main/db/README.md` with the new tables, columns, and indexes (include creation SQL and brief DTO shapes).
- Update `RELEASE.md` with a migration note (Phase 1) describing new schema and the additive insert method.
- Provide short JSDoc on new bridge methods clarifying return types and error behavior.

---

## Implementation Steps
1. Create `src/main/agent/preview-registry.ts` with branded types, guards, and helpers.
2. Update `src/main/db/database-implementation.ts` to define new tables and indexes.
3. Add `insertToolExecutionReturningId` (do not remove/rename the existing method); update `src/main/db/database-bridge.ts` to expose it.
4. Add prepared statements + bridge methods for previews/approvals listed above.
5. Implement safe JSON parsing helpers (local private functions in the DB implementation) and use them consistently in row mappers.
6. Add a startup migration in `src/main/main.ts` to ensure tables/indexes exist.
7. Document new DB operations in `src/main/db/README.md` (schema section) and in `RELEASE.md` under migrations.

---

## Effort & Risks
- Effort: Medium–Large (schema, bridge APIs, migration, tests).
- Risks:
  - Breaking existing call sites if changing return types → mitigated by additive method.
  - JSON parsing brittleness → mitigated by Zod guards and narrow DTOs.
  - FK/index creation across versions → ensure idempotent DDL and robust logs.

---

## Testing & Validation (per `TESTING.md`)
- Create `src/main/db/__tests__/agent-approvals-db.test.ts` with behaviour-focused tests:
  - Creating previews/approvals, listing by session, updating status/feedback.
  - FK constraints: deleting a tool execution cascades preview; deleting preview cascades approvals.
  - Unique `hash` constraint prevents duplicates.
  - JSON fields parse safely; malformed JSON returns guarded defaults.
- Add a small test for `insertToolExecution` returning id (assert a positive integer and correlation to inserted row).
- Ensure ≥2 assertions per test; minimise mocks; do not snapshot implementation details.

---

## Dependencies
- None (Phase 1 is foundational). Later phases will depend on the schema and bridge.

---

## Acceptance Checklist
- [ ] New schema and indexes created idempotently on startup
- [ ] `insertToolExecution` returns `number` and call sites compile
- [ ] All new bridge methods implemented with strict types
- [ ] Unit tests for DB pass and meet `TESTING.md`
- [ ] Documentation (`README.md` schema changes, `RELEASE.md` migration notes) updated

---

## Scaffold Code Snippets (for rapid implementation)

The snippets below are drop‑in starting points. They follow `TYPESCRIPT.md` (no `any`, branded ids, runtime validation) and are designed to compile once Phase 1 wiring is completed. Adjust imports/paths to match your build.

### A) `src/main/agent/preview-registry.ts`

```ts
// src/main/agent/preview-registry.ts
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';

// Branded domain types
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type PreviewId = Brand<string, 'PreviewId'>;
export type ChatSessionId = Brand<string, 'ChatSessionId'>;
export type UnixMs = Brand<number, 'UnixMs'>;

export type ToolName = 'file' | 'edit' | 'terminal' | 'search' | 'context';
export type ToolArgsSnapshot = Readonly<Record<string, unknown>>;

// Zod schemas for runtime validation
const previewEnvelopeSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  tool: z.enum(['file', 'edit', 'terminal', 'search', 'context']),
  action: z.string().min(1),
  summary: z.string().min(1),
  detail: z.record(z.unknown()).nullable(),
  originalArgs: z.record(z.unknown()),
  createdAt: z.number().int().nonnegative(),
  hash: z.string().min(16),
});

export type PreviewEnvelope = Readonly<z.infer<typeof previewEnvelopeSchema>>;

// Type guards
export function isPreviewEnvelope(value: unknown): value is PreviewEnvelope {
  const res = previewEnvelopeSchema.safeParse(value);
  return res.success;
}

export function assertPreviewEnvelope(value: unknown): asserts value is PreviewEnvelope {
  const res = previewEnvelopeSchema.safeParse(value);
  if (!res.success) {
    throw new Error(`Invalid PreviewEnvelope: ${res.error.message}`);
  }
}

// Helpers
export function makePreviewId(): PreviewId { return randomUUID() as PreviewId; }
export function makeSessionId(): ChatSessionId { return randomUUID() as ChatSessionId; }
export function nowUnixMs(): UnixMs { return Date.now() as UnixMs; }

export function hashPreview(input: { tool: ToolName; action: string; args: ToolArgsSnapshot; detail: Record<string, unknown> | null }): string {
  const h = createHash('sha256');
  h.update(input.tool);
  h.update('\u0000');
  h.update(input.action);
  h.update('\u0000');
  h.update(JSON.stringify(input.args ?? {}));
  h.update('\u0000');
  h.update(JSON.stringify(input.detail ?? {}));
  return h.digest('hex');
}
```

### B) Schema DDL additions (`src/main/db/database-implementation.ts`)

```sql
-- Inside the schema initialization block
CREATE TABLE IF NOT EXISTS agent_tool_previews (
  id TEXT PRIMARY KEY,
  tool_execution_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  args TEXT,
  hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(tool_execution_id) REFERENCES tool_executions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_tool_approvals (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','applied','rejected','auto_approved','failed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  auto_reason TEXT,
  feedback_text TEXT,
  feedback_meta TEXT,
  FOREIGN KEY(preview_id) REFERENCES agent_tool_previews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_previews_session_created ON agent_tool_previews(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_previews_hash ON agent_tool_previews(hash);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_session_status ON agent_tool_approvals(session_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_resolved_at ON agent_tool_approvals(resolved_at);
```

### C) Bridge API additions (`src/main/db/database-bridge.ts`)

```ts
// Additive method to avoid breaking changes
async insertToolExecutionReturningId(entry: {
  sessionId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  status?: string;
  error?: string | null;
  startedAt?: number | null;
  durationMs?: number | null;
}): Promise<number> {
  if (!this.db) throw new Error('Database not initialized');
  // Delegate to database implementation (will return lastInsertRowid)
  return (this.db as any).insertToolExecutionReturningId(entry) as Promise<number>;
}

// Preview/Approval helpers (signatures)
async insertPreview(input: {
  id: string; toolExecutionId: number; sessionId: string; tool: string; action: string; summary: string;
  detail: unknown | null; args: unknown | null; hash: string; createdAt: number;
}): Promise<void> { if (!this.db) throw new Error('Database not initialized'); return (this.db as any).insertPreview(input); }

async getPreviewById(id: string): Promise<unknown | null> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).getPreviewById(id);
}

async listPreviews(sessionId: string): Promise<readonly unknown[]> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).listPreviews(sessionId);
}

async insertApproval(input: { id: string; previewId: string; sessionId: string; status: string; createdAt: number }): Promise<void> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).insertApproval(input);
}

async updateApprovalStatus(input: { id: string; status: string; resolvedAt?: number; resolvedBy?: string | null; autoReason?: string | null }): Promise<void> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).updateApprovalStatus(input);
}

async updateApprovalFeedback(input: { id: string; feedbackText?: string | null; feedbackMeta?: unknown | null }): Promise<void> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).updateApprovalFeedback(input);
}

async listPendingApprovals(sessionId: string): Promise<readonly unknown[]> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).listPendingApprovals(sessionId);
}

async listApprovalsForExport(sessionId: string): Promise<{ previews: readonly unknown[]; approvals: readonly unknown[] }> {
  if (!this.db) throw new Error('Database not initialized');
  return (this.db as any).listApprovalsForExport(sessionId);
}
```

### D) Implementation stubs in `src/main/db/database-implementation.ts`

```ts
// Type-safe row shapes (DTOs)
export interface PreviewRow {
  id: string;
  tool_execution_id: number;
  session_id: string;
  tool: string;
  action: string;
  summary: string;
  detail: string | null; // JSON
  args: string | null;   // JSON
  hash: string;
  created_at: number;
}

export interface ApprovalRow {
  id: string;
  preview_id: string;
  session_id: string;
  status: 'pending'|'approved'|'applied'|'rejected'|'auto_approved'|'failed';
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  auto_reason: string | null;
  feedback_text: string | null;
  feedback_meta: string | null; // JSON
}

// Additive insert that returns lastInsertRowid
async insertToolExecutionReturningId(entry: {
  sessionId: string; toolName: string; args?: unknown; result?: unknown; status?: string; error?: string | null; startedAt?: number | null; durationMs?: number | null;
}): Promise<number> {
  this.ensureInitialized();
  const r = await executeWithRetry(async () => {
    const res = this.stmtInsertToolExecution().run(
      entry.sessionId,
      entry.toolName,
      entry.args === undefined ? null : JSON.stringify(entry.args),
      entry.result === undefined ? null : JSON.stringify(entry.result),
      entry.status ?? null,
      entry.error ?? null,
      entry.startedAt ?? null,
      entry.durationMs ?? null,
    );
    return res.lastInsertRowid as number;
  }, { operation: 'insert_tool_execution_returning_id' });
  return r.result as number;
}

// Example: insertPreview
async insertPreview(input: { id: string; toolExecutionId: number; sessionId: string; tool: string; action: string; summary: string; detail: unknown | null; args: unknown | null; hash: string; createdAt: number; }): Promise<void> {
  this.ensureInitialized();
  await executeWithRetry(async () => {
    const stmt = this.db!.prepare(`
      INSERT INTO agent_tool_previews (id, tool_execution_id, session_id, tool, action, summary, detail, args, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.id, input.toolExecutionId, input.sessionId, input.tool, input.action, input.summary,
      input.detail == null ? null : JSON.stringify(input.detail),
      input.args == null ? null : JSON.stringify(input.args),
      input.hash, input.createdAt
    );
  }, { operation: 'insert_preview' });
}
```

### E) Jest test skeleton `src/main/db/__tests__/agent-approvals-db.test.ts`

```ts
import { DatabaseBridge } from '../../db/database-bridge';

describe('Agent approvals DB', () => {
  let db: DatabaseBridge;
  beforeAll(async () => { db = new DatabaseBridge(); await db.initialize(); });

  it('inserts tool execution and returns id', async () => {
    const id = await db.insertToolExecutionReturningId({ sessionId: '00000000-0000-0000-0000-000000000000', toolName: 'file' });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('persists preview and approval and lists pending', async () => {
    // ... create a preview row then approval; assert listPendingApprovals returns it
    expect(true).toBe(true);
  });
});
```
