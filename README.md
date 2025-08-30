# PasteFlow

A desktop app for efficiently selecting, packaging, and copying code to share with AI assistants.

![PasteFlow Screenshot](https://github.com/user-attachments/assets/d17bc6b4-4c92-4775-8f25-f99fed7d2385)

## Features

- Pack workflow
  - Progressive Preview Pack: background file processing with seamless Pack → Preview/Copy workflow
  - Smart file batching and UI that stays responsive during large packs
- File Tree Navigation
  - Browse and select files/folders from your codebase
  - Line Range Selection: copy specific line ranges
- Token Counting
  - Unified token service: renderer worker pool with estimation fallback; main uses tiktoken; batch support for lists
  - Per-item token breakdown via API and CLI (file/range-level counts + totals)
- Smart Exclusions
  - Automatically excludes binaries, build outputs, vendor artifacts, and common non-source files
- System Prompts
  - Create and manage reusable prompts bundled with your code packs
- Workspace Management
  - Save and restore complete application state (workspaces) backed by SQLite
- Dark Mode
  - Light and dark themes

## Installation

Download the latest release from the Releases page.

Or build from source:

```bash
git clone https://github.com/yourusername/pasteflow.git
cd pasteflow
npm install
npm run build-electron   # orchestrates a production build (Vite + packaging)
npm run package          # package for current platform via electron-builder
```

Notes
- Packaging requires native modules (better-sqlite3). The project runs a rebuild on postinstall and also provides a build-native script if needed.
- Electron Builder hooks (e.g., notarize) are compiled TypeScript scripts located under build/scripts after npm run build:scripts, and are invoked automatically by packaging scripts.

## Development

Single-command development (recommended):

```bash
# Start the full dev environment: Vite + Electron orchestrated in one process
npm run dev:electron
```

Additional commands:

```bash
# Start only the Vite dev server (UI). Usually not needed when using dev:electron.
npm run dev

# Run tests
npm test
npm run test:watch
```

Why single-command dev?
- We use a TypeScript dev orchestrator dev.ts executed via tsx. It launches Vite, detects the dev port dynamically, builds/watches the Electron main process TypeScript, and then spawns Electron with the correct start URL. This preserves exactly the same behavior as the previous JS launcher but in TypeScript.

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
- TypeScript compile for Electron main/preload to CommonJS (build/main)
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

## Command-Line Interface (CLI)

PasteFlow ships a first‑party CLI that talks to the local HTTP API exposed by the Electron main process. It enables headless workflows (automation, CI scripts) that mirror app capabilities.

Prerequisites
- Start the app so the local HTTP server is running and port/token are written to ~/.pasteflow:
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
- Only files and select commands enforce absolute paths in the CLI; the server remains the source of truth for path validation.
- If you see NO_ACTIVE_WORKSPACE, initialize one:
  ```bash
  pasteflow folders open --folder "/your/repo"
  # or
  pasteflow workspaces load <id>
  ```

Implementation
- CLI code lives under cli/src; see entry [cli/src/index.ts](cli/src/index.ts), HTTP client and discovery [cli/src/client.ts](cli/src/client.ts), and command implementations under [cli/src/commands/](cli/src/commands/).

## Workspaces and the Database

PasteFlow uses a high-performance SQLite database with:
- Worker thread isolation for non-blocking I/O
- Connection pooling for concurrency
- Automatic retry logic for transient failures
- Typed interfaces across the stack

See the database layer docs for details at:
- src/main/db/README.md

## Contributing

- Use npm run dev:electron for local development
- Keep docs and scripts in sync with TypeScript updates:
  - Scripts live under scripts/*.ts and are executed with tsx in dev
  - Packaging hooks are compiled (build/scripts) and used by electron-builder at runtime

## License

MIT
