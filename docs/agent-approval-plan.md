# Agent Approval UX Alignment Plan (v2.1)

Objective: deliver a consent-first approval flow comparable to Cline’s rich experience while retaining PasteFlow’s preview-first tool architecture.

---

## 0. Design Principles
- **Context-rich previews**: every approval request must show actionable metadata (diffs, paths, icons, warnings) before the user acts.
- **Adaptive actions**: primary/secondary buttons adapt to the tool/action just like Cline’s button configuration system.
- **Multi-modal feedback ready**: the UI should capture optional textual notes (and later attachments) for future agent turns.
- **Streaming aware**: approvals gracefully handle long-running tool output or partial previews without freezing the UI.
- **Auditability**: all approvals are persisted with status changes, who approved, and the applied tool call.
- **Feature-gated rollout**: the new stack runs behind an `AGENT_APPROVAL_V2` pref/env flag so we can flip between the legacy `AgentToolCalls` UX and the new approvals list until QA is complete.

---

## 1. Data & Persistence Foundations
The existing persistence layer (`src/main/db/database-implementation.ts`, `database-bridge.ts`) only tracks raw tool executions. We need strongly typed preview/approval entities so every apply action is auditable and replayable without violating the rules in `TYPESCRIPT.md`.

1. Create `src/main/agent/preview-registry.ts` to house shared types and guards. Define branded identifiers (`type PreviewId = Brand<string, "PreviewId">`, etc.) and a runtime validator `assertPreviewEnvelope(value: unknown): asserts value is PreviewEnvelope` that narrows IPC payloads safely.
2. Model `PreviewEnvelope` with readonly fields: `readonly detail: Record<string, unknown> | null`, `readonly originalArgs: ToolArgsSnapshot`, `readonly createdAt: UnixMs`. Keep the existing `{ type: 'preview' }` tool payloads; the envelope is emitted via `onToolExecute` for persistence/IPC.
3. Update `DatabaseBridge.insertToolExecution` and its statement to return the inserted row id (`Promise<number>`). Touch all call sites (`src/main/handlers/chat-handlers.ts`, `src/main/main.ts`, and relevant tests) so they await the id and propagate precise types (no `Promise<void>` fall-through). Update mocks in `src/main/__tests__` accordingly.
4. Create `agent_tool_previews` table with foreign keys back to `tool_executions`:
   - Columns: `id TEXT PRIMARY KEY`, `tool_execution_id INTEGER NOT NULL`, `session_id TEXT NOT NULL`, `tool TEXT NOT NULL`, `action TEXT NOT NULL`, `summary TEXT NOT NULL`, `detail TEXT`, `args TEXT`, `hash TEXT UNIQUE NOT NULL`, `created_at INTEGER NOT NULL`.
   - Indexes: `(session_id, created_at DESC)` and `hash` for dedupe.
   - Parse `detail`/`args` via the guard before returning to callers (never cast `JSON.parse` directly).
5. Create `agent_tool_approvals` table:
   - Columns: `id TEXT PRIMARY KEY`, `preview_id TEXT NOT NULL`, `session_id TEXT NOT NULL`, `status TEXT CHECK(status IN ('pending','approved','applied','rejected','auto_approved','failed'))`, `created_at INTEGER NOT NULL`, `resolved_at INTEGER`, `resolved_by TEXT`, `auto_reason TEXT`, `feedback_text TEXT`, `feedback_meta TEXT`.
   - Foreign key `preview_id` → `agent_tool_previews(id)` with `ON DELETE CASCADE` and indexes on `(session_id, status)` + `(resolved_at)`.
6. Extend `DatabaseBridge` with helpers: `insertPreview`, `getPreviewById`, `listPreviews(sessionId)`, `insertApproval`, `updateApprovalStatus`, `updateApprovalFeedback`, `listPendingApprovals(sessionId)`, `listApprovalsForExport(sessionId)`. Each helper should return readonly typed DTOs, perform JSON parsing through safe narrowing, and never widen to `any`/`unknown`.
7. Add a startup migration step in `main.ts` (next to the existing approval-mode migration) that creates tables/indexes as needed and logs success/failure. Document the migration in `RELEASE.md`.

---

## 2. Main-Process Approval Lifecycle
We already funnel agent traffic through `src/main/handlers/chat-handlers.ts` (HTTP API) and `ipcMain.handle('agent:execute-tool', ...)` in `src/main/main.ts`. Extend these paths to persist previews, enforce approvals, and surface updates via IPC while keeping strict typing.

1. Introduce `src/main/agent/approvals-service.ts` exporting functions like `recordPreview`, `createApproval`, `applyApproval`, `rejectApproval`. This service should depend on `DatabaseBridge`, `AgentSecurityManager`, and `getAgentTools` while preserving strong types.
2. In both main entry points (`chat-handlers.ts` + `main.ts`), wrap `onToolExecute` so that when a tool returns `{ type: 'preview', ... }` we:
   - validate the payload via `assertPreviewEnvelope` before persistence;
   - persist the preview (`insertPreview`), capturing the execution id from step §1.3;
   - create a pending approval row (`insertApproval`);
   - broadcast `agent:approval:new` via the service (use `BrowserWindow.webContents.send`). Non-preview results continue to route unchanged.
3. Register new IPC endpoints in `main.ts` using Zod schemas for validation (extend `src/main/ipc/schemas.ts`):
   - `agent:approval:list`
   - `agent:approval:watch`
   - `agent:approval:apply`
   - `agent:approval:apply-with-content`
   - `agent:approval:reject`
   - `agent:approval:cancel-stream`
   - `agent:approval:rules:set` and `agent:approval:rules:get`
   Each handler should return discriminated unions (success/error) with precise typings.
4. Enforce state transitions server-side through the service. Direct tool calls with `apply: true` must check for an approved/auto-approved record; otherwise return `{ type: 'error', code: 'APPROVAL_REQUIRED', message }`. Honour `ENABLE_FILE_WRITE` / `ENABLE_CODE_EXECUTION` flags and rate limits (`AgentSecurityManager`).
5. Emit structured logs for auditing (e.g., `[Agent][Approval] state change`) including approval id, session id, tool, and actor. Use existing `console.log` patterns inside try/catch to avoid crashes.
6. Capture error metadata (e.g., blocked reasons) in the approval row (`auto_reason` or a new field) so the renderer can show contextual messaging.

---

## 3. Renderer State & IPC Wiring
1. Build `useAgentApprovals` in `src/hooks/use-agent-approvals.ts`:
   - Accept `sessionId`, `featureEnabled`, and optional filters.
   - Fetch `agent:approval:list` on mount or session change.
   - Subscribe to `agent:approval:watch` via the preload facade and maintain a `ReadonlyMap<PreviewId, ApprovalViewModel>`.
   - Expose memoised actions (`approve`, `approveWithEdits`, `reject`, `cancel`, `setBypass`, `setRules`) that call IPC and optimistically update state.
   - Use `useReducer` or `useSyncExternalStore` to avoid stale closures; ensure state types are readonly to satisfy `TYPESCRIPT.md`.
2. Enhance `src/main/preload.ts` with typed wrappers for the new IPC channels. Provide helper functions (e.g., `ipc.approvals.list(payload)`) that validate payloads via the same Zod schemas used in main (shared through a `common` module or duplicated carefully without `any`). Ensure listeners are properly deregistered when React unmounts.
3. In `src/components/agent-panel.tsx`, read the `AGENT_APPROVAL_V2` flag (via `/prefs/get`) and conditionally render an `AgentApprovalsPane` component between notifications and messages. When disabled, continue rendering `AgentToolCalls` so legacy behaviour remains.
4. Migrate the “Skip approvals” toggle to call the hook’s `setBypass` action rather than manipulating tool invocations directly. Persist the toggle value to `agent.approvals.skipAll` using `/prefs/set`.
5. Remove auto-approval side effects from `AgentToolCalls.tsx` (it becomes a pure log). Any automatic apply should now flow through the approvals service to keep behaviour consistent.

---

## 4. Approval UI & Action Buttons
1. Implement `getApprovalButtons(preview, context)` in `src/components/agent-approvals/button-config.ts`. Accept `{ preview: PreviewEnvelope; status: ApprovalStatus; streaming: StreamingState; bypassEnabled: boolean }` and return a readonly array of typed button descriptors (`kind`, `label`, `icon`, `onSelect`, `disabled`, `analyticsId`). Cover edge cases (blocked actions, streaming) and add unit tests.
2. Create `src/components/agent-approvals/AgentApprovalCard.tsx` to render:
   - Header (tool icon from existing icon set, file path relative to workspace, status badge).
   - Body (diff/terminal preview from §5, metadata chips for token counts, byte counts, path warnings).
   - Feedback textarea + action buttons (wired to hook actions).
   Use semantic HTML (`<article>`, `<header>`, `<footer>`) and keep props readonly. Add CSS under `agent-approvals.css`.
3. Create `AgentApprovalList.tsx` to render a virtualised list of cards. Use `react-window` (already used in `virtualized-file-viewer`) when pending approvals > N to avoid DOM blowup. Provide empty/loading states via `AgentApprovalEmptyState.tsx`.
4. Integrate the list in `AgentPanel` (after notifications, before messages). Ensure layout adapts to narrow widths and that keyboard navigation/focus management meet accessibility expectations.
5. Rename the header toggle to “Bypass approvals” (see §7) and wire it to the hook so button state matches the stored preference.

---

## 5. Preview Rendering & Context
1. File diff previews: add `src/components/agent-approvals/diff-preview.tsx`. Reuse diff logic from `src/main/agent/tools/edit/diff-utils.ts` to compute hunks, render them with syntax highlighting, and support expand/collapse. Display metadata (token counts, `exists` flag) from the preview envelope.
2. File write/delete/move previews: render action chips (“Create file”, “Delete file”) plus before/after snippets styled similarly to `virtualized-file-viewer.tsx`. Highlight out-of-scope paths using warnings gleaned from `validateAndResolvePath` results embedded in the preview.
3. Terminal command previews: extract the streaming output renderer from `src/components/terminal-panel.tsx` into a reusable `TerminalOutputView` component so approval cards can show live output, status icons, and tail controls.
4. For other tool types (e.g., context, search), provide simple summary widgets (counts, truncated results). Implement `JsonPreview` fallback to render structured JSON safely with copy-to-clipboard support.
5. Ensure all preview components accept readonly typed props, avoid mutation, and follow `TYPESCRIPT.md` (no implicit `any`).

---

## 6. Feedback Capture & Follow-ups
1. MVP: integrate an optional comment textarea within each approval card. Persist comments via `updateApprovalFeedback` in the main service and append a synthetic `user_feedback` message to the chat thread so the agent can react next turn.
2. Provide explicit secondary actions (“Request changes”, “Mark applied”) that transition status, persist feedback, emit IPC updates, and optionally reopen the preview.
3. Stage-2 (attachments): reuse the content-area upload pipeline to attach files or screenshots. Store attachment metadata in `feedback_meta`, write files to workspace-safe paths, and ensure all helpers satisfy the rules in `TYPESCRIPT.md` (no `any`, explicit error unions).
4. Consider canned response presets stored in preferences (`agent.approvals.quickReplies`) to speed up repeated reviews.

---

## 7. Approval Actions & Skip Modes
1. Approve & Apply: call `agent:approval:apply` (service replays original tool using `skipPermissions: true`, records new `tool_execution`, updates approval status, emits update, shows “Applied” badge).
2. Approve with edits: open an inline editor (diff textarea) seeded from preview detail, send payload via `agent:approval:apply-with-content`, validate and apply server-side, and log modified diff in `feedback_meta`.
3. Request changes: mark status `rejected`, persist feedback, emit update, keep collapsed summary with reviewer comment, and optionally re-open preview for context.
4. Skip/bypass toggle: migrate preference from `agent.skipApprovals` to `agent.approvals.skipAll`. When enabled, approvals auto-advance to `auto_approved` (subject to §8 caps). When disabled, manual flow applies regardless of auto rules. Update `AgentPanelHeader` labels/tooltips accordingly.

---

## 8. Auto-Approval Rules
1. Extend `ModelSettingsModal` with an “Auto approvals” panel. Let users add per-tool/per-action rules (`kind: 'tool'`) or path-based globs (`kind: 'path'`) plus terminal risk thresholds. Validate with Zod and persist under `agent.approvals.rules` as precise discriminated unions.
2. During preview persistence, evaluate rules inside the approvals service. Matching rules mark the row `auto_approved`, record `auto_reason`, and immediately call `agent:approval:apply`. Guard against infinite loops and provide telemetry events.
3. Enforce per-session auto-apply caps (e.g., max 5 per session) to avoid runaway automation; fall back to manual approvals when exceeded.
4. Surface auto-approved items in the UI with badges and a collapsible “Auto-approved this session” section so users can audit behaviour.

---

## 9. Streaming & Interrupt Handling
1. Track preview streaming state in the envelope (`'pending' | 'running' | 'ready' | 'failed'`) and propagate updates from `preview-controller.ts` through the approvals hook so UI can disable/enable actions appropriately.
2. Provide a `Stop`/`Cancel` action that calls `agent:approval:cancel-stream`, aborts the underlying job, marks the approval `rejected`, and retains partial output for inspection. Persist cancellation timestamps for audit.
3. Display inline progress indicators, skeleton loaders, and tooltips (“preview still generating…”) to keep users informed during long tasks. Allow “Proceed while running” only for supported command types.

---

## 10. Audit Trail & Export
1. Expand `agent:export-session` to include joined preview/approval data (`{ session, toolExecutions, usage, approvals: { previews, approvals } }`). Keep schema additive so older exports still parse.
2. Add an approvals timeline component (or extend `AgentToolCalls`) to visualise preview → decision → apply events with timestamps, reviewer identity, and action summaries.
3. Consider capturing file hashes pre/post apply and storing them in the preview row to verify applied changes when exporting.

---

## 11. Feature Flag, Testing & Rollout
1. Introduce an `AGENT_APPROVAL_V2` feature flag (env + preference). Default off; when disabled, skip creating preview/approval rows and continue using the legacy `AgentToolCalls` flow for safety.
2. Testing (follow `TESTING.md`: behaviour-first, ≥2 assertions per test, minimal mocks):
   - **Main process**: new Jest suites covering preview persistence, approval state transitions, auto-apply caps, IPC validation, and bypass toggle behaviour.
   - **Database**: extend `src/main/db/__tests__` to cover new statements and ensure constraints (unique hash, foreign keys) fire as expected.
   - **Renderer**: add React Testing Library coverage for `AgentApprovalCard`, list filtering, streaming states, and the `useAgentApprovals` hook (mock preload once per file).
   - **End-to-end** (optional): Playwright smoke test to simulate an edit diff, require approval, approve, and verify the file changed.
   - Add regression coverage ensuring legacy behaviour stays intact when the flag is off.
3. Documentation: update `AGENTS.md` with a user-facing overview, refresh release notes, and provide an internal runbook for the consent flow.
4. Manual QA checklist: verify diff/command previews, streaming cancel, auto-approval rules, feedback propagation, export payloads, and preference migration from `agent.skipApprovals`.

---

## Implementation Phases (Suggested)
1. **Data layer**: schemas, bridge helpers, tool execution id plumbing, preload channel scaffolding.
2. **Main-process lifecycle**: preview capture, approval creation, IPC apply/reject logic, auto-apply evaluation.
3. **Renderer MVP**: hook + list + basic card rendering + approve/reject actions (text feedback only).
4. **Enhancements**: diff rendering polish, streaming/stop wiring, auto-approval UI, timeline/export updates.
5. **Testing & rollout**: automated coverage, migration scripts, documentation updates (`AGENTS.md`, release notes), gradual enablement of `AGENT_APPROVAL_V2`.

Outcome: a modern approval experience matching Cline’s depth—dynamic actions, rich context, auditable decisions, and streaming-aware interactivity—implemented within PasteFlow’s Electron + React architecture and tool execution pipeline.
