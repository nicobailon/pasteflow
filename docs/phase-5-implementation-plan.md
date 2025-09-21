# Phase 5 Execution Guide — Immediate Cutover (No Flags, No Fallback)

This document replaces the prior Phase 5 draft and is written for execution by an LLM coding agent with limited reasoning. It provides exact, verifiable steps, paths, commands, and checkpoints. Follow steps in order. Do not introduce feature flags or legacy fallbacks.

All work must honour TYPESCRIPT.md (no widened types, branded IDs, exhaustive unions) and TESTING.md (behaviour-first assertions, ≥2 per test, minimal mocks).

The plan is split into two self-contained sub‑plans:
- Plan 5A: Main/DB/IPC hardening + immediate cutover groundwork
- Plan 5B: Renderer UX polish + feedback/audit + e2e + docs

Each plan includes starting context, steps, validations, and handoff.

---

## Plan 5A — Main/DB/IPC Hardening and Immediate Cutover Groundwork

Starting State (assume Phases 1–4 complete):
- Approvals types/services exist in `src/main/agent/approvals-service.ts` and DB helpers in `src/main/db`.
- Terminal manager exists at `src/main/terminal/terminal-manager.ts`.
- IPC endpoints for approvals exist in `src/main/main.ts` and preload bindings in `src/main/preload.ts`.
- Renderer includes approvals components under `src/components/agent-approvals/*` and hook `src/hooks/use-agent-approvals.ts`.
- Some renderer/main code still conditionally gates approvals via `agent.approvals.v2Enabled`.

Outcomes:
- Approvals are always on (no feature flag, no legacy path) at the main/IPC layers.
- Cancelling an in‑flight terminal preview terminates the underlying terminal session and marks the approval as failed with reason `cancelled`.
- Streaming state can be persisted into preview.detail via a new DB helper.
- DB gains pruning for approvals tables. Diagnostics script added.
- All steps include validations; CI green on unit suites touched here.

Tools/Commands used in this plan:
- ripgrep: `rg -n PATTERN PATH`
- build: `npm run build:main:esm`
- tests: `npm test -- src/main/...` (or entire suite)
- types: `npm run lint:strict`
- run app (optional validation): `npm run dev:electron`

### Step A0 — Baseline checks
1) Run: `npm ci`
2) Run: `npm run build:main:esm`
3) Run: `npm test -- -i` (serial to reduce flake)
Validation: All commands succeed. If not, stop and report errors; do not continue.
Error handling: If build fails due to missing native modules, run `npm rebuild` then retry Step A0.

### Step A1 — Remove approvals feature flag and legacy gating from main/IPC
1) Find flag usage in main: `rg -n "agent\.approvals\.v2Enabled|AGENT_APPROVAL_V2|FEATURE_DISABLED|approvalsFeatureEnabled" src/main`
2) Edit `src/main/main.ts`:
   - In `ipcMain.on('agent:approval:watch', ...)`, delete any branches that send `{ code: 'FEATURE_DISABLED' }`. Always proceed to send `'agent:approval:watch:ready'` if service is present.
   - Ensure `ApprovalsService` is always constructed at startup. If guarded, remove the guard.
3) Edit `src/main/preload.ts`:
   - No flag gating is allowed. Ensure `window.electron.approvals` object is always exported with methods: `list`, `apply`, `applyWithContent`, `reject`, `cancel`, `getRules`, `setRules`, and watch handlers.
4) Preferences cleanup stub in main: add a one‑time startup cleanup that deletes `agent.approvals.v2Enabled` preference if present (use `DatabaseBridge.setPreference(key, null)`). Location: `src/main/main.ts` startup init block.
Validation:
 - Run: `rg -n "agent\.approvals\.v2Enabled|AGENT_APPROVAL_V2|FEATURE_DISABLED" src/main` → no matches except tests/mocks.
 - Build main: `npm run build:main:esm` → success.
Errors:
 - If TypeScript reports missing imports after deleting branches, remove dead imports. Run `npm run lint:strict` and fix unused vars.

### Step A2 — ApprovalsService: cancellation + streaming state persistence
Files:
- `src/main/agent/approvals-service.ts`
- `src/main/db/database-bridge.ts`
- `src/main/db/database-implementation.ts`

2.1) Add cancellation adapters type in `approvals-service.ts` (top‑level export):
   - `export interface ToolCancellationAdapters { readonly terminal?: { kill(sessionId: string): Promise<void> | void; onSessionCompleted?(h: (sessionId: string) => void): () => void; onSessionOutput?(h: (sessionId: string, chunk: string) => void): () => void; }; }`
   - Extend `ApprovalsServiceDeps` with optional `cancellationAdapters?: ToolCancellationAdapters`.
   - Store as `this.cancellationAdapters = deps.cancellationAdapters ?? {}`.
2.2) Add helper method `private async updatePreviewDetail(id: PreviewId, patch: Readonly<Record<string, unknown>>): Promise<void>` that calls the new DB bridge method (see A3).
2.3) Update `cancelPreview(params: { previewId: PreviewId }): Promise<ServiceResult<null>>`:
   - Load `const preview = await this.requirePreview(params.previewId)`.
   - If `preview.tool === 'terminal'` and `preview.detail?.sessionId` is a string, call `await this.cancellationAdapters.terminal?.kill?.(String(preview.detail.sessionId))` in try/catch; log warnings only.
   - Call `await this.db.updateApprovalStatus({ id: params.previewId, status: 'failed', resolvedAt: nowUnixMs(), autoReason: 'cancelled', resolvedBy: 'user' })`.
   - Call `await this.updatePreviewDetail(preview.id, { streaming: 'failed', cancelledAt: nowUnixMs() })`.
   - Emit update event unchanged.
2.4) Optional streaming signals (non‑blocking): expose `private updateStreamingState(previewId: PreviewId, state: 'running'|'ready'|'failed', patch?: Record<string, unknown>)` used by terminal adapter callbacks added in A4.
Validation:
 - Build main: `npm run build:main:esm`.
 - Unit focus: `npm test -- src/main/__tests__/approvals-service.test.ts` should pass; add tests if missing in Step A7.
Errors: If `preview.detail.sessionId` parsing fails, coerce via `String(value)` only when `typeof value === 'string' || typeof value === 'number'`.

### Step A3 — Database: preview detail patch + approvals pruning
Files:
- `src/main/db/database-bridge.ts`
- `src/main/db/database-implementation.ts`

3.1) Bridge method: add `async updatePreviewDetail(input: { id: PreviewId; patch: Readonly<Record<string, unknown>> }): Promise<void>` that delegates to implementation.
3.2) Implementation:
   - Add prepared statement `UPDATE agent_tool_previews SET detail = ? WHERE id = ?`.
   - Method `async updatePreviewDetail(input)`: fetch current row via `getPreviewById(input.id)`. If no row → throw `Error('Preview not found')`.
   - Parse `row.detail` JSON into object or `{}`. Deep merge readonly copies with `input.patch` (shallow is acceptable in Phase 5; do not mutate nested arrays). Serialize using existing `serializeJson` util.
   - Write merged JSON back with the statement.
3.3) Add pruning: `async pruneApprovals(olderThanTs: number): Promise<{ previews: number; approvals: number }>`
   - Two statements: `DELETE FROM agent_tool_approvals WHERE resolved_at IS NOT NULL AND resolved_at < ?` and `DELETE FROM agent_tool_previews WHERE created_at < ? AND id NOT IN (SELECT preview_id FROM agent_tool_approvals WHERE status='pending')`.
   - Return counts from `.run().changes`.
3.4) Bridge wrapper for prune method.
Validation:
 - Build main.
 - Add a targeted unit in `src/main/db/__tests__/agent-approvals-db.test.ts` that inserts a preview+approval, calls `updatePreviewDetail`, verifies readback merge, then prunes with cutoff in future and asserts deletions.
Errors: For `SQLITE_BUSY|LOCKED`, retry via existing `executeWithRetry`; do not add in‑memory fallbacks.

### Step A4 — TerminalManager streaming and cancellation wiring
Files:
- `src/main/terminal/terminal-manager.ts`
- `src/main/main.ts`
- `src/main/agent/approvals-service.ts`

4.1) In `terminal-manager.ts`:
   - Ensure the class extends `EventEmitter` (already does). Add explicit `emit('exit', id)` when PTY exits and when child process `exit` fires.
   - Add JSDoc for events: `'data'` `(id: string, chunk: string)`, `'exit'` `(id: string)`.
4.2) In `src/main/main.ts` when lazily creating TerminalManager (search `getTerminalManagerLazy`):
   - After creating instance, register listeners once to forward events to approvals service if needed: store a singleton, not per call.
4.3) Wire adapters into ApprovalsService creation:
   - When constructing `approvalsService = new ApprovalsService({ db: database, security, broadcast, ... })`, add `cancellationAdapters: { terminal: { kill: (sessionId) => tm.kill(sessionId), onSessionCompleted: (h) => { tm.on('exit', h); return () => tm.off('exit', h); } } }`.
   - If `tm` is lazy, pass a function that calls `getTerminalManagerLazy()` then invokes `kill`. Use `async` and `await` inside adapter.
Validation:
 - Manual: Start app (`npm run dev:electron`), trigger a long‑running terminal preview, call `window.electron.approvals.cancel({ previewId })` from devtools or use UI once Plan 5B lands. Verify session is killed.
 - Automated placeholder: add a unit test that stubs adapters and asserts `cancelPreview` calls `kill` when detail has `sessionId`.
Errors: If multiple listeners cause memory leak warnings, register once by caching handlers.

### Step A5 — IPC schemas and watch events are unconditional
Files:
- `src/main/main.ts`
- `src/main/preload.ts`

5.1) Ensure `ipcMain.handle('agent:approval:list'|'apply'|'apply-with-content'|'reject'|'cancel-stream'|'rules:get'|'rules:set')` are all registered unconditionally at startup.
5.2) Ensure `ipcMain.on('agent:approval:watch')` always sends `'agent:approval:watch:ready'` unless the window is destroyed. Remove any `'FEATURE_DISABLED'` sends.
5.3) In preload, ensure `approvals.watch` registers listeners for `'agent:approval:new'` and `'agent:approval:update'` every time, and `unwatch` removes them.
Validation: `rg -n "FEATURE_DISABLED|v2Enabled" src/main` → no matches; build main.
Errors: If TypeScript complains about missing `IPC_...` constants, import from existing IPC constants file or inline strings consistently.

### Step A6 — Telemetry utility and approvals diagnostics script
Files:
- `src/main/agent/approvals-telemetry.ts` (new)
- `scripts/approvals-doctor.ts` (new)

6.1) Create `src/main/agent/approvals-telemetry.ts` exporting `logApprovalEvent(event: { type: 'apply'|'reject'|'cancel'|'auto_approve'; previewId: string; sessionId: string; status?: string; durationMs?: number }): void` that writes JSON line to console with prefix `[approvals]`.
6.2) Call `logApprovalEvent` from `applyApproval`, `rejectApproval`, and `cancelPreview` after DB status updates.
6.3) Add `scripts/approvals-doctor.ts` using `tsx` runtime. It should:
   - Connect to DB via `DatabaseBridge` and print: counts for pending/approved/applied/failed for the current session, auto‑rule counts from `agent.approvals.rules`, auto‑cap from `agent.approvals.autoCap`.
   - Command to run: `npx tsx scripts/approvals-doctor.ts --session <id>`.
Validation: `npx tsx scripts/approvals-doctor.ts --session test` runs without throwing (mock session ok).
Errors: If Electron APIs are unavailable in script, gate usage to pure DB calls only.

### Step A7 — Unit tests for main/DB flows (targeted)
Files:
- `src/main/__tests__/approvals-service.test.ts`
- `src/main/db/__tests__/agent-approvals-db.test.ts`

7.1) Add tests to cover:
   - `cancelPreview` marks failed and calls adapter `kill` when terminal detail carries `sessionId` (mock adapter, assert call).
   - `updatePreviewDetail` merges JSON and persists.
   - `pruneApprovals` deletes expected rows and preserves pending.
7.2) Run: `npm test -- src/main/__tests__/approvals-service.test.ts src/main/db/__tests__/agent-approvals-db.test.ts`
Validation: Tests pass with ≥2 assertions per test; no skipped tests.
Errors: If timing issues occur, use fake timers or inject deterministic clock via parameterizing `nowUnixMs` (optional).

### Step A8 — Handoff to Plan 5B
Produce a short status in `docs/phase-5-implementation-plan.md` (this file) marking Plan 5A complete and listing artifacts created:
- Cancellation adapters wired; preview detail patcher; pruning; telemetry util; diagnostics script; main/preload unconditional IPC.
Next: implement renderer UX, feedback propagation, exports, and e2e per Plan 5B.

**Status (September 18, 2025):** Plan 5A is complete.
- Main process no longer gates approvals; legacy `agent.approvals.v2Enabled` preference is scrubbed on startup and IPC handlers run unconditionally.
- `ApprovalsService` now accepts terminal cancellation adapters, persists streaming state via `updatePreviewDetail`, and hooks terminal events to update or cancel previews.
- Database bridge/implementation gained `updatePreviewDetail` and `pruneApprovals`, plus tests covering terminal cancellation, preview patching, and pruning behaviour.
- Terminal manager emits explicit `exit` events; adapters are wired through `getTerminalManagerLazy` for cancellation and streaming callbacks.
- Added `src/main/agent/approvals-telemetry.ts` and integrated event logging for apply/reject/cancel/auto-approve flows.
- Added `scripts/approvals-doctor.ts` for diagnostics (prints counts, rules, auto-cap; falls back gracefully outside Electron).

Plan 5A Success Criteria:
- No occurrences of `AGENT_APPROVAL_V2`, `agent.approvals.v2Enabled`, or `FEATURE_DISABLED` in `src/main` or `src/main/preload.ts`.
- `cancelPreview` in `src/main/agent/approvals-service.ts` calls terminal `kill(...)` when `preview.detail.sessionId` exists and updates approval to `failed` with `autoReason='cancelled'`.
- `updatePreviewDetail` exists in DB bridge + implementation and persists JSON patches.
- `pruneApprovals(cutoff)` exists and deletes resolved/old rows while preserving pending.
- Unit tests for these paths are green; `npm run build:main:esm` passes.

---

## Plan 5B — Renderer UX, Feedback/Audit, E2E, Documentation (Immediate Cutover)

Starting State (after Plan 5A):
- Main always exposes approvals IPC; no feature flag remains in main or preload.
- `ApprovalsService.cancelPreview` terminates terminal sessions; `updatePreviewDetail` and telemetry exist; pruning available.
- Diagnostics script exists.

Outcomes:
- Renderer always shows approvals UI; no conditional rendering; legacy `AgentToolCalls` approvals flow is removed.
- Approval cards include adaptive actions, approve‑with‑edits, and auto‑approved digest tray.
- Reviewer feedback appears in chat via main IPC call chain and is exported.
- Playwright e2e verifies end‑to‑end approvals flow; docs updated for GA cutover.

Tools/Commands used in this plan:
- ripgrep: `rg -n PATTERN src`
- build renderer: `npm run build`
- tests: `npm test -- src/components/... src/hooks/...`
- e2e: `npm run test:e2e` (configure in package.json if absent)

### Step B0 — Baseline checks
1) Run: `npm run build` (Vite)
2) Run: `npm test -- -i`
Validation: Green baseline required before edits.

### Step B1 — Immediate cutover in renderer (remove gating + legacy UI)
Files:
- `src/components/agent-panel.tsx`
- `src/components/agent-messages.tsx`
- `src/components/agent-tool-calls.tsx` (to be deleted if only used for legacy approvals UX)

1) Locate gating: `rg -n "agent\.approvals\.v2Enabled|approvalsFeatureEnabled" src/components`
2) Edit `src/components/agent-panel.tsx`:
   - Remove any `/prefs/get` reads for `agent.approvals.v2Enabled`.
   - Always instantiate `const approvalsState = useAgentApprovals({ sessionId, enabled: panelEnabled });` (drop the feature flag variable).
   - Always render `<AgentApprovalList ... />` in the panel at its previous gated location.
3) Edit `src/components/agent-messages.tsx`:
   - Always render `<ApprovalTimeline sessionId={sessionId} approvalsEnabled={true} />` when `sessionId` set.
   - When rendering `<AgentToolCalls ... />`, pass `approvalsEnabled={false}` or remove the component if it solely drove legacy approvals. If other non‑approval display logic remains, keep that logic.
4) If `AgentToolCalls` is now unused, delete `src/components/agent-tool-calls.tsx` and its tests. Otherwise, strip any approvals toggling props and keep only non‑approval display.
Validation:
 - `rg -n "agent\.approvals\.v2Enabled" src/components` → no matches.
 - Build UI: `npm run build`.
Errors: If TypeScript errors reference removed props, update call sites accordingly.

### Step B2 — Approvals UI: adaptive actions + approve with edits
Files:
- `src/components/agent-approvals/button-config.ts`
- `src/components/agent-approvals/agent-approval-card.tsx`
- `src/components/agent-approvals/edit-approval-modal.tsx` (new)
- `src/hooks/use-agent-approvals.ts`

2.1) In `button-config.ts` define button models based on `ApprovalVm` and `StreamingState`:
   - Primary: Approve (enabled when streaming `ready`), Approve with edits (if preview.tool in { 'edit', 'file' }).
   - Secondary: Reject (with optional feedback), Cancel (only when streaming `running` for terminal previews).
2.2) Add `edit-approval-modal.tsx` component to collect edited payload (e.g., updated diff or command args). Validate structure is JSON object, show PREVIEW of changes (basic JSON view acceptable).
2.3) In `agent-approval-card.tsx`:
   - Render buttons via `button-config.ts` builder.
   - Wire `Approve` to `window.electron.approvals.apply({ approvalId })`.
   - Wire `Approve with edits` to open modal, then call `applyWithContent({ approvalId, content })`.
   - Wire `Reject` to `reject({ approvalId, feedbackText, feedbackMeta })`.
   - Wire `Cancel` to `cancel({ previewId })`.
2.4) In `use-agent-approvals.ts` ensure optimistic UI updates on `agent:approval:update` and error toasts when service returns `{ ok: false }`.
Validation:
 - Unit tests (see B6) will cover button enablement and modal submit.
 - Manual: run `npm run dev:electron`, trigger approvals, exercise buttons.
Errors: If modal state leaks, ensure component unmount resets local state.

### Step B3 — Reviewer identity and feedback propagation to chat
Files:
- `src/main/agent/chat-storage.ts` (extend with `appendApprovalFeedbackMessage`)
- `src/main/main.ts` (call chat storage after apply/reject if `feedbackText` present)
- `src/hooks/use-current-user-display-name.ts` (new)
- `src/hooks/use-agent-approvals.ts` (pass `resolvedBy`)

3.1) Add `appendApprovalFeedbackMessage(sessionId: string, approvalId: string, text: string, meta?: unknown): Promise<void>` in `chat-storage.ts`. The helper appends a synthetic user message referencing the approval and stores meta.
3.2) In `ApprovalsService.rejectApproval` and `applyApproval`, after status set, if feedback provided, call the chat storage helper (wire through from IPC payload). If storage fails, continue but log and set `detail.feedbackPersisted=false` via `updatePreviewDetail`.
3.3) Add `use-current-user-display-name.ts` hook returning a safe display name (fallback `'user'`).
3.4) In `use-agent-approvals.ts` actions, include `{ resolvedBy: displayName }` in `reject` payload.
Validation: Unit tests for chat storage call paths (mock bridge) and that `resolvedBy` survives to DB `updateApprovalStatus`.
Errors: If circular deps arise, inject chat storage via constructor into ApprovalsService instead of direct import.

### Step B4 — Auto‑approved digest tray
Files:
- `src/components/agent-approvals/auto-approved-tray.tsx` (new)
- `src/components/agent-approvals/agent-approval-list.tsx`

4.1) Add tray component that accepts `autoApproved: ApprovalVm[]` and renders reasons and links to timeline entries.
4.2) In list component, compute `autoApproved` from state and render the tray above the list when non‑empty.
Validation: Unit test ensures tray renders with count and links when items exist.

### Step B5 — Export enrichment (hashes + feedback)
Files:
- `src/main/agent/approvals-service.ts`
- `src/main/db/database-bridge.ts` (no schema change)

5.1) During `applyApproval`, when tool is `file`/`edit`, compute simple file hashes before/after (use existing file utils if present; otherwise `crypto.createHash('sha1')`). Store in preview detail via `updatePreviewDetail({ beforeHash, afterHash, diffHash? })`.
5.2) Ensure `listApprovalsForExport` already returns previews + approvals. The renderer export should include feedback fields and hashes from preview detail.
Validation: Add a unit in approvals service that calls `applyApproval` on a mock file preview and verifies `updatePreviewDetail` called with expected keys.
Errors: On file read failure, skip hashes; do not block apply.

### Step B6 — Renderer/unit tests and Playwright e2e
Files:
- `src/__tests__/agent-approval-card.test.tsx` (update/extend)
- `src/__tests__/agent-approval-list-integration.test.tsx` (extend)
- `src/__tests__/approval-timeline.test.tsx`
- `tests/e2e/approvals-flow.spec.ts` (new)

6.1) Unit tests to add/refine:
   - Button enablement for streaming states; modal submit calls `applyWithContent` with content.
   - Cancel action sends `cancel` IPC.
   - Auto‑approved tray renders.
6.2) E2E scenario (Playwright):
   - Start app with a sample workspace.
   - Trigger an edit preview; approve with edits; verify file content changed.
   - Trigger a terminal preview; cancel; verify it stops.
   - Verify timeline shows events.
Validation: `npm run test:e2e` green.
Errors: If Playwright infra absent, add minimal config in `package.json` scripts and a basic `playwright.config.ts`.

### Step B7 — Documentation and GA notes
Files:
- `AGENTS.md` (update Approvals section)
- `RELEASE.md` (add breaking change note: immediate cutover, no rollback)
- `docs/approvals-qa-checklist.md` (new)

7.1) Update AGENTS.md: remove any feature flag mentions; document how to use approvals panel and actions.
7.2) Update RELEASE.md: state removal of legacy approvals UX and the `agent.approvals.v2Enabled` preference.
7.3) Add QA checklist file with manual steps mirroring B6 e2e.
Validation: `rg -n "AGENT_APPROVAL_V2|agent\.approvals\.v2Enabled|feature flag" docs AGENTS.md RELEASE.md` → no matches.

### Step B8 — Final acceptance and handoff
Success Criteria:
- Approvals UX renders unconditionally; no feature flag or legacy path remains.
- Cancelling terminal previews halts sessions and updates UI within ~1s.
- Reviewer feedback appears in chat and export payloads include feedback + hashes when available.
- Unit + e2e suites pass; lint/build clean.

Handoff: Tag the release, prepare packaging via `npm run package`, and link QA checklist run results in the PR description.

---

End of Phase 5 Execution Guide.
