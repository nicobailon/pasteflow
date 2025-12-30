# ACP Integration Findings and Plan

## Scope
- Enable external ACP-compliant coding agents to connect to PasteFlow and operate workspace, file, and preview functionality without re-introducing the deprecated in-app agent or terminal panels (`docs/agent-terminal-sunset-plan.md`).
- Reuse existing Electron main services (database, workspace selection, content aggregation) while exposing them through ACP-compliant transports and tool contracts.

## ACP Protocol Highlights (_from upstream documentation_)
- ACP runs over bidirectional JSON-RPC 2.0 transports negotiated via `initialize`. The agent and client exchange capability descriptors (`clientInfo`, `agentInfo`) before any session work begins.[2]
- Sessions are long-lived state machines. Clients request `session/new`, keep track of `session.state` transitions (`idle`, `planned`, `executing`, `complete`, `failed`, `cancelled`), and stream updates with `session/update` notifications.[2]
- Prompts encapsulate user intent. Agents receive `prompt/start` payloads (current context, tool availability, instructions) and respond with `prompt/update` deltas plus a final `prompt/complete` indicating success/failure and optional tool calls.[3]
- Tools are declared during initialization; each tool includes a JSON schema, execution mode, and metadata so agents can decide which capabilities to invoke.[4]

## PasteFlow Architecture Touchpoints
- **Electron Main (`src/main/main.ts`)** bootstraps the BrowserWindow, IPC channels, and the local Express API server (`PasteFlowAPIServer`) that exposes workspace, file, preview, and instruction operations.
- **HTTP API (`src/main/api-server.ts`, `src/main/api-route-handlers.ts`)** wires Express routes to database and filesystem helpers for workspaces, files, instructions, previews, and tool listings.
- **Filesystem & Selection Services (`src/main/file-service.ts`, `src/main/selection-service.ts`, `src/main/content-aggregation.ts`)** enforce path validation, support read/write helpers, and build aggregated content for previews/export flows. These modules already encapsulate the operations ACP tools must expose.
- **Renderer State (`src/index.tsx`, `src/hooks/use-app-state.ts`)** manages user workspace state, file lists, selections, and preview orchestration via IPC/HTTP. Any ACP-driven updates must synchronize with these hooks to keep the UI truthful.
- **Apply-Changes Library (`src/lib/apply-changes.ts`)** provides controlled file mutation primitives (CREATE/UPDATE/DELETE) suitable for mapping to ACP write operations.

## Findings & Gaps
- Existing code still imports legacy agent/terminal modules; the sunset plan assumes these will be removed. The ACP integration must not rely on those paths and should instead introduce a new `acp` package in `src/main/`. (Cleanup of unused imports will be part of preparatory work.)
- PasteFlow’s Express API already covers most ACP tool surface areas (workspace discovery, file reads, token counts, previews). However, ACP expects bidirectional JSON-RPC streams rather than REST/IPC; a dedicated transport layer is required.
- Current renderer lacks UI for agent conversations after the sunset. We need lightweight surfaces (status tray, streaming messages, approval window) to mirror ACP session and prompt states without reviving the old agent panel.
- Security boundaries today rely on the workspace path validator and Express auth token. ACP connections will require equivalent safeguards (auth tokens, allow-lists, lifecycle hooks).

## Proposed Architecture
1. **ACP Manager (Main Process)**  
   - New module `src/main/acp/acp-manager.ts` instantiates a JSON-RPC server (initially WebSocket on `localhost` with configurable port) using `@zed-industries/agent-client-protocol`’s `ClientSideConnection`.  
   - Bridges ACP requests to existing services (`PasteFlowAPIServer`, file-service helpers) and emits events to renderer via IPC for UI updates.

2. **Capability Mapping Layer**  
   - Define ACP tools for:  
     - Workspace enumeration/load (wrap `/api/v1/workspaces/*`).  
     - File metadata/content (`fs.readTextFile`, `fs.writeTextFile` via `file-service` + `applyFileChanges`).  
     - Selection management (map to selection-service helpers).  
     - Preview execution (`preview.start`, `preview.status`) relying on `RendererPreviewProxy`.  
   - Maintain schema definitions so agents understand arguments/results; reuse Zod schemas where possible.

3. **Session & Prompt Orchestration**  
   - Persist minimal session state (sessionId, active prompt, tool calls) in the database (extend `WorkspaceState` or add new ACP tables) so sessions survive restarts.
   - Introduce IPC channels for renderer to display prompt progress and collect optional user approvals (without reintroducing full agent UI).

4. **Configuration & Security**  
   - Add settings to enable ACP (e.g., `PF_ENABLE_ACP`, configurable port, allowed origins).  
   - Reuse `AuthManager` secrets for JSON-RPC auth tokens; block remote connections by default.  
   - Integrate with path-validator to ensure ACP-triggered mutations respect workspace boundaries.

5. **Testing & Observability**  
   - Create integration tests using a mock ACP agent (Node process) to validate handshake, session lifecycle, and file operations.  
   - Add structured logging around ACP events and expose health stats (`/api/v1/status` extension).

## Claude Code Adapter Integration
- **Adapter Alignment**  
  - Adopt `@zed-industries/claude-code-acp` as the first supported ACP agent. The adapter wraps the Claude Code SDK and exposes ACP tools for Claude-native features such as context mentions, code edits, and terminal execution.[5]  
  - Advertise PasteFlow-specific tools (workspace tree, selections, previews) so Claude Code can request granular context beyond its built-in project view.

- **Context Packing Workflow**  
  1. User assembles context in PasteFlow (selected files + ranges, instruction prompts, optional ASCII tree preview).  
  2. `acp-manager` provides a `pasteflow.packContext` ACP tool that marshals this data into the format the Claude Code adapter expects (file metadata, content, relative paths, token counts).  
  3. A companion `pasteflow.injectContext` tool streams the packed payload into Claude Code via the adapter’s “@-mention” or upload APIs, then tracks completion events so the UI can display results.

- **Bidirectional Control Modes**  
  - *Human-driven send*: PasteFlow UI triggers Claude Code prompts (e.g., “Refactor selection”) by calling the adapter’s ACP prompt interface; responses are echoed back into our renderer log panel.  
  - *Agent-driven pull*: Claude Code, running through the adapter, calls PasteFlow ACP tools when it needs fresh context—file reads, diff checks, preview exports—mirroring the workflows shown in the tmux-based transcripts provided by the screenshots.

- **Terminal & tmux Automation**  
  - For scenarios where Claude Code CLI must run interactively, launch it inside a dedicated tmux session (matching the “new-session / capture-pane / kill-session” pattern from the screenshots) and expose session controls as ACP tools (`pasteflow.tmux.start`, `pasteflow.tmux.capture`, `pasteflow.tmux.stop`).  
  - Allow Claude Code to either consume PasteFlow-provided context directly or spawn a temporary Claude Code instance via tmux to ingest large bundles without blocking the main adapter process.

- **Session Persistence & Audit**  
  - Extend database schema to store Claude thread IDs, adapter configuration, and transcripts for replay/diff.  
  - Record every `packContext` payload in approval history so users can verify what was sent to Claude.

- **Configuration**  
  - Add settings for Anthropic API tokens, adapter binary path, tmux enablement, and per-workspace ACLs.  
  - Default to loopback-only connections; show warnings if users opt into remote Claude Code endpoints.

## Implementation Plan
1. **Preparation**
   - Remove residual agent/terminal imports and update `package.json` dependencies.  
   - Add `@zed-industries/agent-client-protocol` and `@zed-industries/claude-code-acp` dependencies plus shared type definitions.  
   - Feature flag configuration: `PF_ENABLE_ACP`, `PF_ACP_PORT`, `PF_ACP_AUTH_TOKEN`, `PF_ACP_TMUX_ENABLED`; Claude Code adapter ships enabled by default whenever ACP is active (optional opt-out can live in advanced settings if needed).

2. **Transport Layer**
   - Implement `AcpTransport` (WebSocket server + JSON-RPC).  
   - Handle `initialize`, capability advertisement, and connection teardown.  
   - Provide authentication via shared secret or loopback-only policy.

3. **Capability Adapters**
   - Map ACP filesystem calls to `file-service` and `applyFileChanges`.  
   - Map workspace/session calls to `PasteFlowAPIServer` helpers.  
   - Expose preview execution via `RendererPreviewProxy` watchers.  
   - Prototype and harden the `pasteflow.packContext` contract against the Claude Code adapter’s expected payloads; implement `pasteflow.injectContext`, and tmux control tools backed by the Claude Code adapter.  
   - Implement error normalization consistent with ACP error codes and adapter-specific failures.

4. **Session & Prompt Management**
   - Store session metadata in database (new tables or JSON column).  
   - Translate ACP prompt updates into renderer IPC events so users see agent progress and results.  
   - Provide optional approval hooks for destructive operations (leveraging existing approval patterns, but scoped to ACP).  
   - Persist Claude-specific thread IDs and transcript snapshots for audit.

5. **Renderer Integration**
   - Add lightweight status UI (e.g., `src/components/acp-status-badge.tsx`) showing connection state and latest agent responses.  
   - Hook into `useAppState` to react to ACP-driven file selections or workspace changes initiated by Claude Code.  
   - Provide “Send to Claude Code” actions in selection panels, and render Claude transcripts/tool outputs in a dedicated log modal.

6. **Validation & Release**
   - Add Jest integration tests for adapters, and end-to-end smoke tests using a sample ACP agent plus Claude Code adapter (e.g., scripted tmux runs).  
   - Update documentation (README, onboarding) with ACP + Claude Code setup steps (including tmux automation).  
   - Roll out behind feature flag; gather telemetry (logs, error counts) before enabling by default.

## Risks & Mitigations
- **Spec Drift** — ACP is evolving; pin SDK versions and monitor upstream releases.  
- **Security** — Exposing mutation tools could allow unintended file changes. Default to disabled, require explicit workspace activation, and gate destructive tools behind approvals.  
- **UI Debt** — Minimal surfaces could confuse users; iterate on UX once functionality stabilizes.

## Open Questions
- Should ACP connections be inbound-only (agent connects) or should PasteFlow spawn agents?  
- Do we need multi-session support for parallel agents per workspace?  
- How should approvals be re-imagined post-sunset (auto-approve vs. manual prompts)?  
- What telemetry is required for compliance/audit when agents modify files?

## References
1. ACP Protocol Repository — https://github.com/agentclientprotocol/agent-client-protocol  
2. Protocol Session Specification — https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/docs/protocol/session.md  
3. Protocol Prompt Specification — https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/docs/protocol/prompt.md  
4. Protocol Interfaces Overview — https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/overview/interfaces.md  
5. Claude Code ACP Adapter — https://github.com/zed-industries/claude-code-acp (npm package `@zed-industries/claude-code-acp`)
