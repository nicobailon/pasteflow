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
- **CLI-First Architecture**: Every feature accessible via CLI for automation and scripting
- **Surgical Selection**: Select specific files and line ranges, not entire directories
- **Tree Visualization**: ASCII tree output for architectural understanding
- **Smart Exclusions**: Automatically filters binaries, node_modules, build artifacts, vendor files

### Token Management
- **Token Intelligence**: Unified token service with tiktoken (GPT-3.5/4 compatible)
- **Per-Item Breakdown**: File and line-range level token counts via API and CLI
- **Batch Processing**: Efficient token counting for large file lists

### Pack Workflow
- Progressive preview: background processing without blocking the UI
- Smooth flow: Pack → Preview → Copy
- Smart batching for large codebases

### Workspace & Prompts
- **Workspace Persistence**: Save and restore complete application state via SQLite
- **System Prompts**: Global and Workspace prompts for consistent context
- **Role Prompts**: Define assistant behavior and tone
- **Instructions**: Reusable instruction snippets
- **Configuration Reuse**: Save context selections for repeated use

### User Experience
- **File Tree Navigation**: Browse and select files/folders from your codebase
- **Line Range Selection**: Copy specific line ranges (e.g., lines 45-120)
- **Dark Mode**: Light and dark themes for comfortable viewing

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

## AI Assistant Integration

PasteFlow works with ANY coding assistant that can execute shell commands. The CLI exposes all functionality for intelligent context building.

### Workflow for AI Assistants (Claude Code, Cursor, etc.)

1. **Map the architecture**: Start with `pf tree --mode complete` to understand codebase structure
2. **Search strategically**: Use tree insights to target searches with `grep` or `rg`
3. **Check file sizes**: Use `pf files info` before reading large files
4. **Select surgically**: Add specific line ranges with `pf select add --lines 45-120`
5. **Verify tokens**: Check total with `pf tokens selection` before sending to LLM
6. **Get content**: Retrieve optimized context with `pf content get`

### Example: Building Context

```bash
# Task: "Fix the performance issue in file selection"

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

PasteFlow ships with a first-party CLI that communicates with the local HTTP API exposed by the Electron main process. This enables both human and AI assistant workflows, as well as headless automation for CI scripts and other automated tasks.

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
- System Prompts
  ```bash
  pasteflow system-prompts list
  pasteflow system-prompts create --name "My Prompt" --content @prompt.txt
  pasteflow system-prompts update <id> --name "New Name" --content @prompt.txt
  pasteflow system-prompts delete <id>
  ```
- Role Prompts
  ```bash
  pasteflow role-prompts list
  pasteflow role-prompts create --name "My Role" --content @role.txt
  pasteflow role-prompts update <id> --name "New Name" --content @role.txt
  pasteflow role-prompts delete <id>
  ```
- User Instructions
  ```bash
  pasteflow user-instructions get [--raw]
  pasteflow user-instructions set --content @instructions.txt
  pasteflow user-instructions clear
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
- `system-prompts create|update|delete`: refreshes the system prompts list in the UI.
- `role-prompts create|update|delete`: refreshes the role prompts list in the UI.
- `user-instructions set|clear`: refreshes user instructions in the UI.
- `prefs set`: refreshes persisted settings across the UI.
- `workspaces create|rename|delete`: refreshes the UI's workspace list.

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

Notes
- Only files and select commands enforce absolute paths in the CLI; the server validates paths.
- If you see NO_ACTIVE_WORKSPACE, initialize one:
  ```bash
  pasteflow folders open --folder "/your/repo"
  # or
  pasteflow workspaces load <id>
  ```

Implementation
- CLI code lives under cli/src; see entry [cli/src/index.ts](cli/src/index.ts), HTTP client and discovery [cli/src/client.ts](cli/src/client.ts), and command implementations under [cli/src/commands/](cli/src/commands/).

## Workspaces and the Database

- SQLite-backed persistence for workspaces (state, prompts, instructions).
- See src/main/db/README.md for details.

## Contributing

- Use `npm run dev:electron` for local development.
- Keep docs and scripts in sync when changing TypeScript build/pack scripts.

## License

MIT
