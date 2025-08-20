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
