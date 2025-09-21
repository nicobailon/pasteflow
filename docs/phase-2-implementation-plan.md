# Phase 2 Implementation Plan — Main-Process Lifecycle & IPC

This document is self-contained and covers the main-process approval lifecycle: capturing previews, persisting approvals, enforcing state, and exposing typed IPC endpoints. It builds on Phase 1 data primitives and storage.

---

## Objectives
- Persist previews during tool execution and create pending approvals automatically.
- Enforce approval state machine before any `apply` operation executes.
- Provide typed IPC endpoints for listing, watching, applying, rejecting, cancelling, and configuring auto-approval rules.
- Integrate with existing security flags (`ENABLE_FILE_WRITE`, `ENABLE_CODE_EXECUTION`) and rate limiting.

### Success Criteria
- Tool preview responses are persisted with correlated `tool_execution_id` and a pending approval is created.
- Bypassing approval (calling `apply: true` directly) results in a structured `APPROVAL_REQUIRED` error unless approvals permit it.
- New IPC endpoints exist with Zod validation and strict TypeScript types.
- Broadcasts for `agent:approval:new` and `agent:approval:update` are delivered to renderer windows.

---

## Technical Requirements & Specs

### Approvals Service (new file)
- Add `src/main/agent/approvals-service.ts` exporting:
  - `recordPreview(params: { preview: PreviewEnvelope; toolExecutionId: number }): Promise<void>`
  - `createApproval(params: { previewId: PreviewId; sessionId: ChatSessionId }): Promise<void>`
  - `applyApproval(params: { approvalId: string; editedPayload?: unknown }): Promise<ApplyResult>`
  - `rejectApproval(params: { approvalId: string; feedbackText?: string; feedbackMeta?: unknown }): Promise<void>`
  - `cancelPreview(params: { previewId: PreviewId }): Promise<void>`
  - `listApprovals(sessionId: ChatSessionId): Promise<{ previews: readonly PreviewRow[]; approvals: readonly ApprovalRow[] }>`
  - `evaluateAutoRules(preview: PreviewEnvelope): AutoRuleMatch | null`
  - All functions use strict types and runtime validation per `TYPESCRIPT.md`.
  - Define discriminated-union results: `type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }` (returned `as const`).

### onToolExecute Integration
- Files to touch:
  - `src/main/handlers/chat-handlers.ts`
  - `src/main/main.ts` (within `ipcMain.handle('agent:execute-tool', ...)`)
- For each tool execution, use a shared helper `capturePreviewIfAny({ name, args, result, sessionId })` that detects a `{ type: 'preview', ... }` result and:
  1) Validate the preview payload via `assertPreviewEnvelope`.
  2) Persist with `recordPreview(...); createApproval(...)` using `insertToolExecutionReturningId` from Phase 1 for correlation.
  3) Broadcast `'agent:approval:new'` with a typed payload for the UI.
  4) Evaluate auto-approval rules (see below); if matched, transition to `auto_approved` and call `applyApproval` immediately, enforcing per-session caps.

### IPC Endpoints (all Zod-validated)
- In `src/main/main.ts` and `src/main/ipc/schemas.ts` define:
  - `agent:approval:list` — request `{ sessionId }` → response `{ previews, approvals }`.
  - `agent:approval:watch` — event channel for pushes with explicit events: `'agent:approval:new'` and `'agent:approval:update'`.
  - `agent:approval:apply` — request `{ approvalId }` → applies original payload.
  - `agent:approval:apply-with-content` — request `{ approvalId, content }` → applies edited payload (for diffs or file writes).
  - `agent:approval:reject` — request `{ approvalId, feedbackText?, feedbackMeta? }`.
  - `agent:approval:cancel-stream` — request `{ previewId }`.
  - `agent:approval:rules:set` / `agent:approval:rules:get` — persist/read auto rules in preferences (`agent.approvals.rules`).
- Return discriminated unions for all responses (e.g., `{ ok: true, data } | { ok: false, error: { code, message } }`).

### Enforcement & Security
- Enforce approval states in the service before applying write/exec actions; return `{ type: 'error', code: 'APPROVAL_REQUIRED' }` when unauthorized.
- Honour `ENABLE_FILE_WRITE` and `ENABLE_CODE_EXECUTION` — if disabled, set a blocked reason and broadcast a disabled-state card to renderer.
- Respect `AgentSecurityManager` rate limits for tool calls.

### Bypass Toggle Migration
- Migrate preference key `agent.skipApprovals` → `agent.approvals.skipAll` during app startup in `src/main/main.ts` (once). Log the result. The toggle only influences the service logic (auto-advance), not direct UI side-effects. Keep legacy UI intact when `AGENT_APPROVAL_V2` is off.

### Coding Standards
- Follow `TYPESCRIPT.md`:
  - All IPC handlers must validate inputs with Zod and return precise types.
  - No `any`; use discriminated unions for tool/IPC results.
  - Avoid type widening; use `as const` for literal responses.

---

## Implementation Steps
1. Create `approvals-service.ts` with typed functions and wire it to `DatabaseBridge` + `getAgentTools`.
2. Add `capturePreviewIfAny` helper; update `chat-handlers.ts` and `main.ts` to call it inside `onToolExecute` paths.
3. Implement IPC endpoints + Zod schemas under `src/main/ipc/schemas.ts` for all approval routes.
4. Add startup migration for `agent.approvals.skipAll` preference.
5. Integrate auto-approval rule evaluation with per-session caps.
6. Add structured logs for preview capture, approval creation, apply/reject, and auto-apply outcomes.

---

## Effort & Risks
- Effort: Large (service + IPC + double integration + rules + events).
- Risks:
  - Double-apply races → guard via approval status transitions (pending→approved→applied) in a single transactional section where possible.
  - Event storms with many previews → consider debounced/coalesced UI updates (renderer will handle gracefully).
  - Misconfigured rules → include rich error reasons and enforce per-session caps.

---

## Testing & Validation (per `TESTING.md`)
- Add `src/main/__tests__/approvals-service.test.ts`:
  - Preview persistence and approval creation on tool preview.
  - State transitions: pending → approved → applied/rejected/failed.
  - Enforcement: direct `apply: true` is blocked without approval.
  - Auto-approval caps respected and disabled flags produce blocked cards.
- Add `src/main/__tests__/ipc-approvals.test.ts` for Zod-validated handlers with behaviour assertions.
- Use real DB (in-memory) and minimal mocks; ≥2 assertions per test.

---

## Dependencies
- Phase 1 complete: types, tables, bridge methods, and migrations available.

---

## Acceptance Checklist
- [ ] Previews persisted and pending approvals created automatically
- [ ] IPC endpoints implemented, validated, and tested
- [ ] Approval enforcement blocks unauthorized apply attempts
- [ ] Auto-approval rules evaluated with caps; bypass toggle migrated
- [ ] Tests pass with good assertion density and minimal mocks

---

## Scaffold Code Snippets (for rapid implementation)

The snippets below are starting points for the main-process service and IPC plumbing. They are designed to drop in alongside existing files without breaking current behavior.

### A) `src/main/agent/approvals-service.ts` (skeleton)

```ts
import type { DatabaseBridge } from '../db/database-bridge';
import { getAgentTools } from '../agent/tools';
import { assertPreviewEnvelope, type PreviewEnvelope, type PreviewId, type ChatSessionId } from './preview-registry';

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface ApprovalsServiceDeps {
  db: DatabaseBridge;
}

export class ApprovalsService {
  constructor(private readonly deps: ApprovalsServiceDeps) {}

  async recordPreview(params: { preview: PreviewEnvelope; toolExecutionId: number }): Promise<ServiceResult<null>> {
    try {
      assertPreviewEnvelope(params.preview);
      await this.deps.db.insertPreview({
        id: params.preview.id,
        toolExecutionId: params.toolExecutionId,
        sessionId: params.preview.sessionId,
        tool: params.preview.tool,
        action: params.preview.action,
        summary: params.preview.summary,
        detail: params.preview.detail,
        args: params.preview.originalArgs,
        hash: params.preview.hash,
        createdAt: params.preview.createdAt,
      });
      return { ok: true, data: null } as const;
    } catch (e) {
      return { ok: false, error: { code: 'PREVIEW_PERSIST_FAILED', message: (e as Error)?.message || 'Failed' } } as const;
    }
  }

  async createApproval(params: { previewId: PreviewId; sessionId: ChatSessionId }): Promise<ServiceResult<null>> {
    try {
      await this.deps.db.insertApproval({
        id: params.previewId,
        previewId: params.previewId,
        sessionId: params.sessionId,
        status: 'pending',
        createdAt: Date.now(),
      });
      return { ok: true, data: null } as const;
    } catch (e) {
      return { ok: false, error: { code: 'APPROVAL_CREATE_FAILED', message: (e as Error)?.message || 'Failed' } } as const;
    }
  }

  async listApprovals(sessionId: ChatSessionId) {
    const previews = await this.deps.db.listPreviews(sessionId);
    const approvals = await this.deps.db.listPendingApprovals(sessionId);
    return { ok: true, data: { previews, approvals } } as const;
  }

  // applyApproval / rejectApproval would:
  // - check state
  // - run the appropriate tool with skipPermissions: true (or with edited payload)
  // - update approval status accordingly
}
```

### B) IPC Schemas additions (`src/main/ipc/schemas.ts`)

```ts
import { z } from 'zod';

export const AgentApprovalListSchema = z.object({ sessionId: z.string().uuid() });
export const AgentApprovalApplySchema = z.object({ approvalId: z.string().uuid() });
export const AgentApprovalApplyWithContentSchema = z.object({ approvalId: z.string().uuid(), content: z.unknown() });
export const AgentApprovalRejectSchema = z.object({ approvalId: z.string().uuid(), feedbackText: z.string().optional(), feedbackMeta: z.unknown().optional() });
export const AgentApprovalCancelSchema = z.object({ previewId: z.string().uuid() });
export const AgentApprovalRulesSetSchema = z.object({ rules: z.array(z.object({ kind: z.enum(['tool','path','terminal']) }).passthrough()) });
export const AgentApprovalRulesGetSchema = z.object({});
```

### C) onToolExecute preview capture helper (usage in main.ts and chat-handlers.ts)

```ts
type CaptureDeps = { service: ApprovalsService; db: DatabaseBridge };

async function capturePreviewIfAny(dep: CaptureDeps, sessionId: string, name: string, args: unknown, result: unknown) {
  const isPreview = !!result && typeof result === 'object' && (result as { type?: string }).type === 'preview';
  if (!isPreview) return;
  const execId = await dep.db.insertToolExecutionReturningId({ sessionId, toolName: name, args, result, status: 'ok' });
  const preview = result as unknown; // to be parsed later via assertPreviewEnvelope inside service
  // In the real integration: construct a PreviewEnvelope from tool result + args
  // Then call: await dep.service.recordPreview({ preview, toolExecutionId: execId }); await dep.service.createApproval(...)
}
```
