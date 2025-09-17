# PasteFlow

Build precise, token-efficient context from any codebase. Select exact files and line ranges via CLI or UI; changes sync instantly between them.

![PasteFlow Screenshot](https://github.com/user-attachments/assets/d17bc6b4-4c92-4775-8f25-f99fed7d2385)

## Why PasteFlow

- CLI-first: automate context assembly for AI coding assistants (Claude Code, Cursor, Continue, etc.).
- Surgical selection: add whole files or specific line ranges.
- Predictable tokens: see counts before sending to LLMs.
- Reusable state: save complete contexts as workspaces.

## Core Features

### Context Building
- **CLI-First Architecture**: Every feature accessible via CLI for external agent integration and automation
- **Surgical Selection**: Select specific files and line ranges, not entire directories
- **Tree Visualization**: ASCII tree output for architectural understanding
- **Smart Exclusions**: Automatically filters binaries, node_modules, build artifacts, vendor files

### Token Management
- **Token Intelligence**: Unified token service with tiktoken (GPT-3.5/4 compatible)
- **Per-Item Breakdown**: File and line-range level token counts via API and CLI
- **Batch Processing**: Efficient token counting for large file lists

### Agent Tools
- **Writable File Operations**: The `file` tool now previews and applies writes, moves, and deletes (when enabled). Previews surface byte + token counts and respect approval mode before mutating files.
- **Diff-First Scaffolding**: `edit.diff` previews can target non-existent files and create them when applied, replacing the old template scaffolding workflow.

### Pack Workflow
- Progressive preview: background processing without blocking the UI
- Smooth flow: Pack → Preview → Copy
- Smart batching for large codebases

### Workspace & Prompts
- **Workspace Persistence**: Save and restore complete application state via SQLite
- **System Prompts**: Separate Global and Workspace prompts. Both are editable in Agent Settings and are the only system text sent to the model (no automatic summary).
  - Replace flags: "Use only this prompt" for Global/Workspace; Workspace wins over Global.
  - Default composition: Global → Workspace (when neither replaces).
- **Configuration Reuse**: Save context selections for repeated use

### System Execution Context
- **Optional**: When enabled, a small environment snapshot is appended after your system prompts.
- **What’s included**: Working Directory, Home Directory, Platform (OS + arch), Shell (name + version when available), and a Timestamp.
- **Refresh behavior**: Collected on initial load and refreshed only when a workspace is opened or a new folder is selected.
- **Toggles**: Global and Workspace toggles in Agent Settings. Workspace toggle overrides Global. Env fallback: set `PF_AGENT_DISABLE_EXECUTION_CONTEXT=1` to force-disable when no preference is set.
- **Privacy**: Includes only non‑sensitive values; absolute paths are limited to cwd/home.

### User Experience
- **File Tree Navigation**: Browse and select files/folders from your codebase
- **Line Range Selection**: Copy specific line ranges (e.g., lines 45-120)
- **Dark Mode**: Light and dark themes for comfortable viewing
- **Agent Model Switcher (WIP)**: Change AI provider/model at runtime from the Agent Panel; configure API keys in a Model Settings modal. Keys are stored locally, encrypted.

### Telemetry & Costs
- **Per‑turn telemetry (persisted)**: The app records input/output/total token usage and server‑side latency for each assistant turn.
- **Cost tracking (server‑side)**: A minimal pricing table computes `cost_usd` for common models; costs are persisted with usage. Unknown models fall back to an approximate UI‑only estimate.
- **UI displays**:
  - Header chip: shows session totals — `total tokens (in: X, out: Y)` and a cost figure when available (no latency).
  - Message rows: user messages display their token count; assistant messages display output tokens and latency. Tooltips show a full breakdown (input/output/total, latency, and cost when known).
  - Model Settings → Session Stats: shows total input/output/overall tokens, average latency, and session cost.
  - Exported sessions include the recorded usage rows.

## Installation

Download the latest release from the Releases page.

Or build from source:

```bash
git clone https://github.com/yourusername/pasteflow.git
cd pasteflow
npm install
npm run package          # build + package for current platform
```

Notes
- Packaging requires native modules (better-sqlite3). The project runs a rebuild on postinstall and also provides a build-native script if needed.
- Electron Builder hooks (e.g., notarize) are compiled TypeScript scripts located under build/scripts after npm run build:scripts, and are invoked automatically by packaging scripts.

## Development

```bash
# Vite + Electron in one command
npm run dev:electron

# UI-only
npm run dev

# Tests
npm test
npm run test:watch
```

### Configuration (Agent)
- PF_AGENT_PROVIDER: default provider id (default: openai) - supports: openai, anthropic, openrouter, groq
- PF_AGENT_DEFAULT_MODEL: default model id (default: gpt-4o-mini)
- PF_AGENT_MAX_CONTEXT_TOKENS: max context size (default: 120000)
- PF_AGENT_MAX_OUTPUT_TOKENS: fallback max output tokens when model-specific limit not available (default: 128000)
- PF_AGENT_TEMPERATURE: default generation temperature (default: 0.3)
- PF_AGENT_MAX_TOOLS_PER_TURN: per-session tool cap per 60s (default: 8)
- PF_AGENT_MAX_RESULTS_PER_TOOL: list/search max results (default: 200)
- PF_AGENT_MAX_SEARCH_MATCHES: code search match cap (default: 500)
- PF_AGENT_ENABLE_FILE_WRITE: enable file writes for edit.apply (default: true)
- PF_AGENT_ENABLE_CODE_EXECUTION: enable terminal execution (default: true)
- PF_AGENT_APPROVAL_MODE: approval policy for tools, values: `never`, `risky`, `always` (default: `risky`).
  - `never`: No approval prompts. Terminal commands and apply operations run when enabled.
  - `risky`: Approval only for known dangerous terminal commands; safe actions proceed.
  - `always`: Approval required for all terminal commands and apply operations.
  - Related: `PF_AGENT_ENABLE_FILE_WRITE` (default: true), `PF_AGENT_ENABLE_CODE_EXECUTION` (default: true)
- PF_AGENT_MAX_SESSION_MESSAGES: persist last N chat messages per session (default: 50)
- PF_AGENT_TELEMETRY_RETENTION_DAYS: days to retain tool/usage telemetry (default: 90)
- PF_AGENT_DISABLE_EXECUTION_CONTEXT: disable system execution context injection (default: false)

### Environment Variables (API Keys)
Provider API keys can be set via environment variables as fallbacks when not configured in the UI:
- OPENAI_API_KEY: OpenAI API key
- ANTHROPIC_API_KEY: Anthropic API key
- OpenRouter uses OPENAI_API_KEY with custom base URL

Note: Groq provider only uses API keys configured through the UI preferences system (no environment variable fallback).

Telemetry & cost notes
- Costs are computed server‑side using a small built‑in pricing table (per 1M tokens) in `src/main/agent/pricing.ts`. The table covers common default models and can be expanded. When a model is not in the table, the UI may show an approximate cost based on a conservative rate.
- Some providers do not return usage tokens for every turn; in those cases the UI labels values as `(approx)` and still records latency.

Notes
- Preferences override env. The Agent Settings modal (header → Agent Settings) persists:
  - `agent.enableFileWrite` (default: true)
  - `agent.enableCodeExecution` (default: true)
  - `agent.approvalMode` (default: risky)
  - `agent.temperature` (default: 0.3)
  - `agent.maxOutputTokens` (default: 4000)
  - Provider credentials and related options

## Build and Packaging

Production build and package for the current platform:

```bash
npm run package
```

Platform-specific packaging:

```bash
npm run package:mac
npm run package:win
npm run package:linux
npm run package:all
```

Under the hood:
- Vite production build for the renderer (dist/)
- tsup builds Electron main and preload/worker as ESM (build/main/*.mjs)
- TypeScript compile for packaging scripts to CommonJS (build/scripts)
- electron-builder is configured to use the compiled afterSign hook at build/scripts/notarize.js

## Tech Stack

- Electron (Main + Preload) — TypeScript
- React 18 — UI framework (TypeScript)
- Vite 5 — Dev/build tool
- better-sqlite3 — Local database for workspace persistence
- Token service (renderer worker + main tiktoken) — Token counting/estimation
- Jest + ts-jest — Test runner and TS support
- tsx — Dev-time execution of TypeScript scripts

## AI Agent Integration

PasteFlow works with ANY coding assistant that can execute shell commands. The CLI exposes all functionality for intelligent context building.

### Workflow for AI Agents (Claude Code, Cursor, etc.)

1. **Map the architecture**: Start with `pf tree --mode complete` to understand codebase structure
2. **Search strategically**: Use tree insights to target searches with `grep` or `rg`
3. **Check file sizes**: Use `pf files info` before reading large files
4. **Select surgically**: Add specific line ranges with `pf select add --lines 45-120`
5. **Verify tokens**: Check total with `pf tokens selection` before sending to LLM
6. **Get content**: Retrieve optimized context with `pf content get`

### Example: Agent Building Context

```bash
# Agent receives: "Fix the performance issue in file selection"

# 1. Understand structure
pf tree --mode complete | grep -E "(select|list|performance)"

# 2. Check file sizes first
pf files info --path src/hooks/use-file-selection.ts
# Output: 450 lines, ~3500 tokens

# 3. Select only relevant sections
pf select add --path src/hooks/use-file-selection.ts --lines 45-120,200-250
pf select add --path src/components/file-list.tsx --lines 80-150

# 4. Verify token budget
pf tokens selection
# Output: 2,100 tokens (vs 15,000 if entire files were included)

# 5. Get optimized context
pf content get
```

### Best Practices

- **Build context once, use in fresh chat**: After building optimal context in PasteFlow, start a new chat with your AI assistant to preserve token limits
- **Use workspaces**: Save context configurations with `pf workspaces create` for reuse
- **Let PasteFlow handle tokens**: The app tracks exact counts, preventing context overflow

## Command-Line Interface (CLI)

PasteFlow ships with a first-party CLI that communicates with the local HTTP API exposed by the Electron main process. This enables both human and AI agent workflows, as well as headless automation for CI scripts and other automated tasks.

Prerequisites
- Start the app so the local HTTP server is running and port/token are written to `~/.pasteflow`:
  ```bash
  npm run dev:electron
  ```
- Build the CLI once per change:
  ```bash
  npm run build:cli
  ```

How to run (local repo)
- Direct execution:
  ```bash
  node cli/dist/index.js status
  ```
- Global installation (one-time setup):
  ```bash
  npm link   # Creates persistent global `pasteflow` and `pf` commands
  pasteflow status
  ```
  Note: `npm link` is a one-time setup that persists across sessions. Rebuild CLI with `npm run build:cli` when making changes.

Global flags
- --host, --port, --token: override discovery from ~/.pasteflow/{server.port,auth.token}
- --json: emit JSON (machine‑readable)
- --raw: print raw content for file/content responses
- --timeout <ms>: HTTP timeout (default ~10s)
- --debug: prints HTTP request/response summary
- -h, --help, --h: show help for any command

Exit codes
- 0: success
- 1: general/server error (includes FILE_SYSTEM_ERROR/INTERNAL_ERROR)
- 2: validation/path denied (VALIDATION_ERROR/NO_ACTIVE_WORKSPACE)
- 3: authentication failure (UNAUTHORIZED)
- 4: not found
- 5: conflict/binary (e.g., BINARY_FILE, name collision, or EEXIST)
- 6: server not running/unreachable

Command overview
- Status
  ```bash
  pasteflow status
  pasteflow status --include-selection   # adds per-file tokens table
  # JSON includes fileTreeMode and selectionSummary
  ```
- Workspaces
  ```bash
  pasteflow workspaces list
  pasteflow workspaces get <id>
  pasteflow workspaces create --name "My WS" --folder "/abs/path"
  pasteflow workspaces update <id> --state @state.json
  pasteflow workspaces delete <id>
  pasteflow workspaces rename <id> --to "New Name"
  pasteflow workspaces load <id>
  ```
- Folders
  ```bash
  pasteflow folders current
  pasteflow folders open --folder "/abs/path" [--name "WS Name"]
  ```
- Instructions
  ```bash
  pasteflow instructions list
  pasteflow instructions create --name "Prompt A" --content @prompt.txt
  pasteflow instructions update <id> --name "New Name" --content @prompt.txt
  pasteflow instructions delete <id>
  ```
- Preferences
  ```bash
  pasteflow prefs get theme
  pasteflow prefs set theme --value '"dark"'
  pasteflow prefs set limits --value @prefs.json
  ```
- Files
  ```bash
  # Absolute paths required (client‑side validation)
  pasteflow files info --path "/abs/path/file.ts"
  pasteflow files content --path "/abs/path/file.ts" [--out out.txt] [--overwrite] [--raw]
  ```
- Tokens
  ```bash
  pasteflow tokens backend
  pasteflow tokens count --text @README.md
  # Alias for selection token breakdown (same as `select list`)
  pasteflow tokens selection [--summary-only] [--relative] [--max-files 500] [--max-bytes 2000000] [--no-include-instructions] [--no-include-prompts]
  ```
- Selection
  ```bash
  # Absolute paths required; optional line ranges "10-20,30,40-50"
  pasteflow select add --path "/abs/path/file.ts" --lines "10-20,30"
  pasteflow select remove --path "/abs/path/file.ts" --lines "30"
  pasteflow select clear
  # Token breakdown for current selection (files + prompts/instructions)
  pasteflow select list [--summary-only] [--relative] [--max-files 500] [--max-bytes 2000000] [--no-include-instructions] [--no-include-prompts]
  # Note: text output now includes current File Tree Mode; --json adds fileTreeMode
  ```
- Tree
  ```bash
  pasteflow tree                      # ASCII file tree for active workspace/mode
  pasteflow tree --json               # JSON { mode, root, tree }
  pasteflow tree --list-modes         # List available file tree modes
  pasteflow tree --mode selected      # Override mode for this call (does not change workspace)
  ```

File tree modes
- none: disables tree output in content; `pf tree` prints empty tree.
- selected: includes only selected files as leaves (no parent directories).
- selected-with-roots: includes selected files and all their parent directories from the workspace root.
- complete: includes all non-ignored files in the workspace (honors .gitignore and exclusion patterns).

Notes
- `pasteflow tree --list-modes` marks the current mode with `* - current`.
- `pasteflow tree --mode <mode>` previews a mode without changing saved workspace state.
- To persist a mode, update the workspace state field `state.fileTreeMode` via `pasteflow workspaces update`.

### UI Synchronization
- `folders open`: opens the folder in the UI immediately.
- `workspaces load`: switches the UI to the workspace folder and applies its selection.
- `select add|remove|clear`: updates selections in the UI (including line ranges).
- `workspaces update`: applies selection-related state changes to the UI.
- `instructions create|update|delete`: refreshes the instructions list in the UI.
- `prefs set`: refreshes persisted settings across the UI.
- `workspaces create|rename|delete`: refreshes the UI’s workspace list.

### Telemetry API (IPC)
- `agent:usage:list` → returns persisted usage rows for a session: `[{ input_tokens, output_tokens, total_tokens, latency_ms, cost_usd, created_at }]`.
- `agent:usage:append` → internal best‑effort fallback used by the renderer to append a row when the provider doesn’t return usage (includes a locally measured latency).

Notes
- Costs in the UI prefer persisted `cost_usd` and fall back to approximations only when pricing or usage is unavailable.

API: Selection token breakdown
- Endpoint: `GET /api/v1/selection/tokens`
- Example:
  ```bash
  curl -H "Authorization: Bearer $(cat ~/.pasteflow/auth.token)" \
       "http://127.0.0.1:5839/api/v1/selection/tokens?relativePaths=true&maxFiles=500&maxBytes=2000000"
  ```
  Response (truncated):
  ```json
  {
    "backend": "tiktoken",
    "files": [
      {
        "path": "/abs/path/src/app.ts",
        "relativePath": "src/app.ts",
        "ranges": null,
        "bytes": 1234,
        "tokenCount": 456,
        "partial": false,
        "skipped": false,
        "reason": null
      }
    ],
    "prompts": {
      "system": [{ "id": "system-0", "name": "System Prompt 1", "tokenCount": 12 }],
      "roles": [],
      "instructions": [],
      "user": { "present": false, "tokenCount": 0 }
    },
    "totals": { "files": 456, "prompts": 12, "all": 468 }
  }
  ```
- Content aggregation
  ```bash
  pasteflow content get [--max-files 500] [--max-bytes 2000000] [--out pack.txt] [--overwrite] [--raw]
  pasteflow content export --out "/abs/path/pack.txt" [--overwrite]   # server‑side write within allowed workspace
  ```
- Preview (asynchronous)
  ```bash
  pasteflow preview start --prompt @prompt.txt [--include-trees] [--max-files 1000] [--max-bytes 5000000]
  pasteflow preview start --prompt @prompt.txt --follow --out preview.md --overwrite
  pasteflow preview status <id> [--watch]
  pasteflow preview content <id> [--out preview.md] [--overwrite] [--raw]
  pasteflow preview cancel <id>
  ```

- Agent Sessions (Phase 4)
  ```bash
  # Export an agent chat session via HTTP API
  pasteflow export-session --id <SESSION_ID> [--out "/abs/path/session.json"] [--stdout]
  # Behavior:
  # - When --out is provided, server validates the path is within the active workspace and writes the file.
  # - When --out is omitted, the server writes to the OS Downloads folder as
  #   "pasteflow-session-<SESSION_ID>.json" and returns the file path.
  # - When --stdout is used, JSON is returned directly without writing.
  ```

Notes
- Only files and select commands enforce absolute paths in the CLI; the server validates paths.
- Agent tools require explicit action values for file/search calls (e.g., `{ action: "read", path }`, `{ action: "code", query }`). Legacy shapes without `action` are not accepted.
- If you see NO_ACTIVE_WORKSPACE, initialize one:
  ```bash
  pasteflow folders open --folder "/your/repo"
  # or
  pasteflow workspaces load <id>
  ```

Implementation
- CLI code lives under cli/src; see entry [cli/src/index.ts](cli/src/index.ts), HTTP client and discovery [cli/src/client.ts](cli/src/client.ts), and command implementations under [cli/src/commands/](cli/src/commands/).

## Agent Runtime Notes

- Rate limiting: Per-session tool executions are capped within a 60s window (PF_AGENT_MAX_TOOLS_PER_TURN). When exceeded, the chat route responds 429 with code RATE_LIMITED.
- Session retention: Only the last PF_AGENT_MAX_SESSION_MESSAGES (default 50) chat messages are persisted per session.
- Telemetry pruning: Tool executions and usage summaries older than PF_AGENT_TELEMETRY_RETENTION_DAYS (default 90) are pruned on startup and weekly.
- Export behavior: Session export via HTTP or IPC defaults to writing in the OS Downloads folder when no outPath is provided; custom outPath is validated against the active workspace. `--stdout` (download=true) returns JSON without writing.
- Tool schemas: Agent tools require explicit action for file/search (e.g., `{ action: "read" }`, `{ action: "code" }`). Legacy shapes without action are not accepted.
- Renderer flags: Renderer feature-flag injection has been removed; the Agent panel displays tool-call details based on message content without feature gating.

### Agent Model Management (WIP)
- Providers: OpenAI, Anthropic, OpenRouter, Groq. Configure in the Model Settings modal (header → Settings). Secrets are stored encrypted and used only locally.
- Runtime switching: Use the Model Switcher under the Agent input to select provider and model. Changes apply to the next turn.
- Defaults: If no preference is set, provider defaults to `openai` and the model to `PF_AGENT_DEFAULT_MODEL` (fallback `gpt-4o-mini`).
- OpenRouter: Optional custom `baseUrl` is supported; model ids are namespaced (e.g., `openai/gpt-5`).
- Groq: Supports Kimi K2 0905 model (`moonshotai/kimi-k2-instruct-0905`) with 16K output tokens and 262K context window.
- API (local):
  - `GET /api/v1/models?provider=openai|anthropic|openrouter|groq` → `{ provider, models: [{ id, label, ...}] }` (static catalog; best-effort).
  - `POST /api/v1/models/validate` → `{ ok: true } | { ok: false, error }` using a tiny generation to verify credentials/model.
  - Telemetry is captured by the chat route and exposed via IPC; session export includes usage rows.

## Workspaces and the Database

- SQLite-backed persistence for workspaces (state, prompts, instructions).
- See src/main/db/README.md for details.

## Appendix: Cost Calculation

PasteFlow computes and persists turn costs on the server. The renderer only displays what is stored, and shows an approximate hint when server pricing/usage is unavailable.

How it works
- Pricing lives in `src/main/agent/pricing.ts` as a small TypeScript table keyed by `provider:modelId` (all lowercase). Rates are expressed per 1,000,000 tokens (per‑million) to match vendor docs.
- On each assistant `onFinish`, the server computes `cost_usd` from actual usage and stores it in `usage_summary` alongside token counts and latency.
- The UI reads rows via IPC (`agent:usage:list`) and shows:
  - Header chip: session totals — total tokens with breakdown (in/out) and a cost figure.
  - Assistant messages: output tokens + latency; tooltip includes input/output/total and cost.
  - User messages: input tokens only (approximate, UI‑side) with a tooltip.

Pricing table format (per‑million)
```ts
export type Pricing = {
  inPerMTok: number;
  outPerMTok: number;
  cacheWritePerMTok?: number;
  cacheReadPerMTok?: number;
  thinkPerMTok?: number;
  subscriptionFree?: boolean; // set true when usage is covered by a subscription
};
```

Computation
- Base: `inCost = inPerMTok * (uncachedInput / 1e6)`, `outCost = outPerMTok * (output / 1e6)`.
- Cache (when available): add `cacheWritePerMTok * (cacheWrites / 1e6)` and `cacheReadPerMTok * (cacheReads / 1e6)`.
- OpenAI‑style rule: if cache read/write counts exist, subtract them from input to avoid double‑counting (uncached input only).
- Thinking tokens (when available): `thinkPerMTok * (thinking / 1e6)`.
- If `subscriptionFree` is set, cost is forced to `0`.

Example
```
Model: openai:gpt-4o-mini (in=$5/M, out=$15/M)
Usage: input=2,000, output=1,000 tokens, no cache
Cost: (5 * 2000/1e6) + (15 * 1000/1e6) = 0.010 + 0.015 = $0.0250
```

Adding or adjusting models
1) Edit `src/main/agent/pricing.ts` and add/update an entry:
```ts
PRICING["openai:gpt-4o-mini"] = { inPerMTok: 5, outPerMTok: 15 };
```
2) Ensure the key matches `provider:modelId` as used by PasteFlow’s model resolver (e.g., `openrouter:openai/gpt-4o-mini`).
3) Restart the app to apply.

Notes & limitations
- Persisted costs are computed server‑side only. The UI may show an approximate cost when pricing or usage is missing; those estimates are labeled `(approx)`.
- Some entries ship as conservative placeholders (e.g., early `gpt-5` values). Update them to your contracts as needed.
- Currency is USD; tax and discounts are not modeled. Values are shown as `$X.XXXX` for readability.

Troubleshooting cost display
- If the header chip shows `0 (approx)`, the provider likely didn’t return token usage yet; the UI is using a text‑length estimate and will switch to persisted values as they arrive in subsequent turns.
- If costs do not appear for a model, add it to the pricing table; the UI otherwise falls back to an approximate hint.

## Contributing

- Use `npm run dev:electron` for local development.
- Keep docs and scripts in sync when changing TypeScript build/pack scripts.

## License

MIT
