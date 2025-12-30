# Agent & Terminal Sunset Plan

## Objectives
- Remove the in-app "Agent" chat workflow and approvals tooling while keeping core file browsing, selection, and preview flows intact.
- Remove the embedded terminal panel and all code-execution IPC/tooling.
- Retire the underlying database tables, preferences, IPC channels, and npm dependencies that only exist to support the agent or terminal features.
- Ship a leaner renderer bundle and main process with fewer attack surfaces and maintenance overhead.

## Current Footprint Summary

### Renderer (Vite/React)
- `src/index.tsx` always mounts `AgentPanel` and `TerminalPanel`, wires resize + toggle events, and installs the agent auth fetch interceptor.
- Agent-specific UI modules under `src/components/` (panel, header, messages, approvals subdirectory, notifications, resize handle, tool calls, status banners) and their CSS.
- Agent-related hooks and utilities: `src/hooks/use-agent-*`, `src/utils/agent-message-utils.ts`, `src/utils/install-agent-auth.ts`, `src/hooks/use-send-to-agent-bridge.ts`, plus shared types in `src/types/agent-types.ts` and `src/shared-types/agent-context.ts`.
- Content area integration: `src/components/send-to-agent-button.tsx`, agent buttons in the approval cards, and `AgentPanelHeader` toggles.
- Terminal UI: `src/components/terminal-panel.tsx` and CSS, `agent-panel` header toggle, `terminal-output-view` in approvals, and custom window events.
- Preload contracts assumed by renderer: `window.electron.approvals.*`, `agent:*` IPC notifications, and terminal IPC methods.

### Main Process (Electron)
- Entire `src/main/agent/` tree (config, tools, system prompt, approvals service, security manager, chat storage, preview capture, pricing).
- Agent-specific IPC wiring in `src/main/main.ts` (`agent:*` handlers for sessions, usage, approvals, threads) plus terminal IPC block (`terminal:*`).
- API server pieces: `/api/v1/chat`, `/api/v1/models`, `/api/v1/tools`, `/api/v1/agent/export-session` in `src/main/api-server.ts`, `api-route-handlers.ts`, and `handlers/chat-handlers.ts`, `models-handlers.ts`, `agent-handlers.ts`, `tools-handlers.ts`.
- Database support in `src/main/db/database-implementation.ts` & friends: tables (`chat_sessions`, `tool_executions`, `usage_summary`, `agent_tool_previews`, `agent_tool_approvals`) and bridge methods.
- Terminal manager in `src/main/terminal/terminal-manager.ts` plus its reuse inside `agent` terminal tool.
- IPC schemas in `src/main/ipc/schemas.ts` for agent + terminal channels.

### Persistence & Filesystem Artifacts
- SQLite tables mentioned above and associated preference keys (`agent.*`, `integrations.*`, `ui.reasoning.*`).
- On-disk JSON threads under `~/Library/Application Support/PasteFlow/.agent-threads` (or platform equivalent).

### Tests, Docs, Tooling
- Jest suites in `src/__tests__/agent-*` and `src/main/__tests__/agent-*` plus approval/terminal tests.
- Docs: `AGENTS.md`, `docs/agent-*.md`, `agent-tool-system-audit.md`.
- Scripts or notes that reference agent tooling (search for `agent` / `terminal`).

### npm Dependencies Only Used for Agent/Terminal
- Agent: `ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/groq`, `@ai-sdk/provider-utils`, `@ai-sdk/*`, plus `unified-diff` (for edit tool), `tiktoken` (check other usage), and reasoning helpers.
- Terminal: `node-pty`, `xterm`, `xterm-addon-fit`, `xterm-addon-web-links`.
- Supporting UI icons/text may remain but confirm redundancy.

## Refactor Plan (Phased)

### Phase 1 – Renderer Entry Points
1. Remove `AgentPanel` and `TerminalPanel` imports/usages in `src/index.tsx`, delete related resize/toggle effects, and strip `installAgentAuthInterceptor()`.
2. Replace `SendToAgentButton` in `src/components/content-area.tsx` with existing copy/export actions (or hide the container) to keep layout stable.
3. Update `AppHeader` / `AgentPanelHeader` usage sites; delete `AgentPanelHeader` entirely and collapse header actions that only drive agent/terminal toggles.
4. Remove window events `pasteflow:send-to-agent` and `pasteflow:toggle-terminal` listeners/emitters across the renderer.
5. Delete or refactor any UI that referenced approvals or model configuration modals (e.g., `ModelSelector`, `ModelSettingsModal`, `IntegrationsModal` if no longer needed).

### Phase 2 – Renderer Module Cleanup
1. Delete agent-specific components, hooks, utils, css, and tests; ensure imports are purged and TypeScript references removed.
2. Remove terminal-specific components (`terminal-panel`, approvals terminal view) and associated styles.
3. Update `src/types/` and `src/shared-types/` to drop agent types; prune barrel exports.
4. Re-run Vite bundler locally to confirm no missing module errors.

### Phase 3 – Preload & IPC Surface
1. Strip `window.electron.approvals` exposure and related whitelist entries in `src/main/preload.ts`.
2. Remove agent/terminal IPC handlers (`agent:*`, `terminal:*`) from `src/main/main.ts`; ensure any broadcast helpers or maps (`approvalWatchers`) are deleted.
3. Update `src/main/ipc/schemas.ts` to drop agent and terminal schemas; adjust any imports that relied on them.

### Phase 4 – Main Process Services & API
1. Delete the entire `src/main/agent/` directory and callers (chat handlers, approvals service, tools, etc.).
2. Remove `/api/v1/chat`, `/api/v1/models`, `/api/v1/tools`, and `/api/v1/agent/export-session` routes plus their handler modules.
3. Simplify `PasteFlowAPIServer` constructor to omit agent dependencies (no approvalsService/securityManager wiring).
4. Audit remaining modules (`preview-controller`, `workspace` flows) to ensure no residual agent imports remain.
5. Update TypeScript types and exports to reflect removed modules (e.g., Narrows in `src/main/api-route-handlers.ts`).

### Phase 5 – Database & Persistence Cleanup
1. Update schema creation in `database-implementation.ts` to drop agent/terminal tables; add a migration that drops existing tables/indexes safely.
2. Remove DAO/bridge methods (`upsertChatSession`, `listToolExecutions`, `listUsageSummaries`, approval methods) and adjust call sites.
3. Delete preferences and migrations tied to `agent.*`, `integrations.*`, `ui.reasoning.*`; ensure default seeds do not recreate them.
4. Document a one-off script (or migration) to delete the `.agent-threads` directory on upgrade.

### Phase 6 – Dependency & Build Hygiene
1. Remove unused npm packages from `package.json` and lockfile (agent + terminal deps, plus related type packages).
2. Update Electron-builder config if any extra files were packaged for agent/terminal (e.g., remove `node-pty` from asar unpack list).
3. Adjust ESLint/tsconfig if there are overrides for `agent/**/*.ts`.

### Phase 7 – Tests & Tooling
1. Delete Jest suites covering agent/terminal; update coverage thresholds if necessary.
2. Update any helper mocks referencing agent IPC.
3. Ensure `npm test`, `npm run lint`, and `npm run build` pass; add targeted tests if new functionality replaces agent workflows.

### Phase 8 – Documentation & UX Messaging
1. Remove/replace agent-focused docs (`AGENTS.md`, `docs/agent-*.md`, audit notes) and update README sections advertising the feature.
2. If needed, add migration notes in `RELEASE.md` describing the removal and how to manually delete residual data.
3. Update in-app copy/tooltips that referenced the agent or terminal.

### Phase 9 – QA & Rollout
1. Regression-test core flows: workspace load/save, file scanning, previews, exports, instructions.
2. Validate no `agent` or `terminal` IPC calls appear in devtools (use Electron logging).
3. Monitor crash/telemetry logs post-release for missing dependency errors.

## Risks & Mitigations
- **Hidden dependencies**: non-agent code might rely on shared helpers located in the agent tree. Mitigation: move shared portions to neutral modules before deletion.
- **Database migration**: dropping tables without guarding could break existing installations. Add idempotent migrations and backups.
- **Third-party dependency reuse**: confirm packages like `tiktoken` or `unified-diff` are not used elsewhere before removal.
- **User expectations**: communicate change early; provide alternative workflows (e.g., copy to clipboard) so workflow loss is understood.

## Testing Strategy
- Automated: `npm run lint`, `npm test`, `npm run build`, `npm run verify-build`.
- Manual smoke: launch via `npm run dev:electron`, open large repo, verify file browsing, instructions, exports, and ensure no agent/terminal UI or IPC errors surface.
- Upgrade test: run the app with an existing data directory that previously used agent features; confirm migrations succeed and leftover UI does not reference removed prefs.

## Follow-Up Tasks
- Capture before/after bundle size metrics and document in release notes.
- Consider adding optional integration hooks (e.g., allow external LLM via URL) if replacement planned.
- Update CI workflows to drop agent-specific steps or secrets (API keys).
