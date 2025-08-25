# PasteFlow CLI Commands — Implementation Plan

Purpose
- Define a concrete plan to add a first‑party command-line interface (CLI) that integrates with PasteFlow’s existing HTTP API server for CRUD operations and related automation tasks.
- Assess the current architecture to confirm which capabilities are already exposed via REST and determine appropriateness of surfacing them in CLI form.
- Outline the command taxonomy, user experience goals, integration points, error handling, and a phased development roadmap.

Authoritative code references
- API server and routes: [PasteFlowAPIServer](src/main/api-server.ts:102), [`registerRoutes()`](src/main/api-server.ts:193)
- Electron main boot and server port write: [main.ts](src/main/main.ts:241)
- Auth token management: [AuthManager](src/main/auth-manager.ts:6)
- Error normalization: [toApiError()](src/main/error-normalizer.ts:26), [ok()](src/main/error-normalizer.ts:30)
- Security model and path access: [PathValidator](src/security/path-validator.ts:9), [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6)
- File/Content services: [validateAndResolvePath()](src/main/file-service.ts:49), [statFile()](src/main/file-service.ts:77), [readTextFile()](src/main/file-service.ts:127)
- Aggregation/export: [aggregateSelectedContent()](src/main/content-aggregation.ts:176), [writeExport()](src/main/export-writer.ts:10)
- IPC envelopes and schemas (GUI): [main IPC handlers](src/main/main.ts:667), [schemas](src/main/ipc/schemas.ts:1)

--------------------------------------------------------------------------------

1) Architecture Assessment

1.1 What exists today
- HTTP REST API server runs within the Electron main process:
  - Bound to 127.0.0.1 with port selection/scan starting at 5839; see [`startAsync()`](src/main/api-server.ts:139)
  - Writes discovered port to ~/.pasteflow/server.port and manages token at ~/.pasteflow/auth.token
    - Port write: [main.ts](src/main/main.ts:261)
    - Token creation and validation: [AuthManager.validate()](src/main/auth-manager.ts:16)
- Comprehensive endpoints are implemented:
  - Health/status: [health, status](src/main/api-server.ts:195)
  - Workspaces CRUD, rename, load: [workspaces](src/main/api-server.ts:220)
  - Instructions CRUD: [instructions](src/main/api-server.ts:312)
  - Preferences: [prefs](src/main/api-server.ts:364)
  - File info/content: [files info/content](src/main/api-server.ts:390)
  - Token counting: [tokens](src/main/api-server.ts:470)
  - Folder convenience: open/current: [folders](src/main/api-server.ts:495)
  - Selection management: [select/deselect/clear/selected](src/main/api-server.ts:549)
  - Content aggregation/export: [content, content/export](src/main/api-server.ts:706)
  - Advanced (Phase 4): preview: [preview](src/main/api-server.ts:805)
- Error response model is normalized across routes via [error-normalizer.ts](src/main/error-normalizer.ts:1) and consistently used in handlers.
- Security model relies on allow-first validation relative to the active workspace, using singleton path validator and workspace context:
  - [PathValidator.validatePath()](src/security/path-validator.ts:29)
  - [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6)
- IPC layer exists primarily for GUI/renderer interactions (not required for CLI once HTTP is used). IPC handlers also return camelCase shapes and map DB snake_case fields (e.g., [`mapWorkspaceDbToIpc`](src/main/main.ts:655)) — the HTTP API mirrors this mapping in route helpers (e.g., [`mapWorkspaceDbToJson`](src/main/api-server.ts:90)).

1.2 What does not exist
- No packaged CLI binary within this repo:
  - package.json has no "bin" entry
  - No top-level cli/ code or commander/yargs entry point
- The PRD’s CLI client is illustrative; real CLI is expected to be built on top of the HTTP API.

1.3 Conclusion of assessment
- CRUD functionality is implemented via HTTP endpoints, not direct terminal commands.
- This is appropriate as a transport layer; adding a CLI wrapper will improve discoverability, ergonomics, input validation, and output formatting without modifying core app logic.
- The CLI should be a thin client that:
  - Reads ~/.pasteflow/server.port and ~/.pasteflow/auth.token
  - Calls the HTTP API with consistent error mapping
  - Provides a coherent command taxonomy with helpful interactive hints
  - Avoids re-implementing business logic or state management locally

--------------------------------------------------------------------------------

2) Should CRUD be exposed via CLI?

2.1 Appropriate to expose
- Workspaces: list/create/get/update/delete/rename/load — useful for automation (e.g., CI scripts, repo bootstrap tasks)
- Instructions: create/list/update/delete — aligns with declarative setup and scripting for team presets
- Preferences: get/set — safe for targeted keys, useful in initialization scripts
- Selection management: select/deselect/clear/selected — appropriate for automation of aggregation pipelines
- Content aggregation and export — highly suited for automation and headless generation of packs

2.2 Less appropriate or careful handling
- File content of large/binary files — CLI should protect users with size/binary warnings (HTTP already enforces; CLI can add guard rails and confirmation flags)
- Advanced features (preview) — still appropriate for CLI, but:
  - Preview is asynchronous with statuses; CLI should present progress and timeouts clearly

2.3 Final determination
- Yes, CRUD (and more) is appropriate for CLI. It should be opt-in and safe by default with clear flags for heavy operations.

--------------------------------------------------------------------------------

3) Proposed CLI Command Structure

3.1 Binary and invocation
- Binary name: pasteflow (pf as an alias)
- Global options:
  - --port, --token to override discovery from ~/.pasteflow files
  - --host default 127.0.0.1; rarely overridden
  - --json to emit JSON payloads (for scripting)
  - --timeout to cap request duration (default 5-10s)
  - --raw to output raw content (for content exports and file content)
  - --debug to show HTTP requests and normalized errors

3.2 Command taxonomy
- pasteflow status
  - Shows server status, active workspace, allowed paths
- pasteflow workspaces list|get <id>|create --name --folder --state@file|update <id> --state@file|delete <id>|rename <id> --to <newName>|load <id>
- pasteflow folders open --folder <path> [--name <name>]|current
- pasteflow instructions list|create --name --content@file|update <id> --name --content@file|delete <id>
- pasteflow prefs get <key>|set <key> --value <json>|--value@file
- pasteflow files info --path <abs>|content --path <abs> [--out <file>] [--raw]
- pasteflow tokens count --text@file|--text "<text>"|backend
- pasteflow select add --path <abs> [--lines 10-20,30-35 ...] | remove --path <abs> [--lines ...] | clear | list
- pasteflow content get [--out <file>] [--raw] | export --out <abs> [--overwrite]
- Advanced:
  - pasteflow preview start [--include-trees] [--max-files N] [--max-bytes N] [--prompt@file|--prompt "<p>"] | status <id> | content <id> | cancel <id>

3.3 UX principles
- Human-friendly default output with --json switch for machine-readable output
- Fail fast with helpful diagnostics; map server errors to ergonomic messages while preserving code in --json mode
- Support @file syntax for large inputs (state JSON, instruction content, prompt text)
- Provide examples via pasteflow help and contextual hints

--------------------------------------------------------------------------------

4) Integration Approach

4.1 Transport and discovery
- HTTP client: axios or undici; axios suffices for simplicity and JSON handling
- Read token/port from:
  - ~/.pasteflow/auth.token (required): [AuthManager](src/main/auth-manager.ts:21)
  - ~/.pasteflow/server.port (required): written by main at [main.ts](src/main/main.ts:261)
- Allow overrides via env (PASTEFLOW_TOKEN, PASTEFLOW_PORT) and flags

4.2 Error handling
- On non-2xx: parse { error: { code, message, details? } } per [toApiError()](src/main/error-normalizer.ts:26)
- Display concise messages by default:
  - 401: Unauthorized — re-check token file
  - 400: Validation error — echo message/details
  - 403: Path denied — show workspace path hint
  - 404: Not found — mention resource
  - 409: Conflict (binary file or name collision)
  - 500: Internal/DB error — suggest checking app logs
- In --json mode, print raw error JSON unchanged

4.3 Security model compliance
- Enforce absolute paths for file/selection commands
- Provide a preflight hint if NO_ACTIVE_WORKSPACE occurs:
  - Suggest: pasteflow folders open --folder /your/project
  - Or: pasteflow workspaces load <id>
- Avoid reading or writing outside allowed workspace; rely on server validation

4.4 Output formatting
- Tables for list views (workspaces, instructions)
- SPDX-like summary for status
- Rich path info for files info
- Write-to-file behaviors:
  - --out path: write raw data (content/export); confirm overwrite with --overwrite or reject if exists
- Paging/limit flags for search/tree

4.5 Config and profiles (optional future)
- Support a config file at ~/.pasteflow/cli.json with defaults (port, token path, json output preference)
- Allow “profiles” for multiple local instances (future)

--------------------------------------------------------------------------------

5) Development Roadmap

Phase A — Foundations (1 week)
- Scaffold CLI package:
  - Directory: cli/ or packages/cli/ (monorepo-style acceptable later)
  - Entry point: src/index.ts with commander
  - Add bin in root package.json or publish as separate package: "bin": { "pasteflow": "dist/cli.js", "pf": "dist/cli.js" }
  - Build with tsx/tsc; ship as Node (no native deps)
- Core services:
  - Env + file discovery for token/port
  - Axios instance factory with auth header and base URL
  - Unified error handler that honors --json and plain modes
  - Shared flags parser for --json, --timeout, --debug
- Commands: status, workspaces list/get/create, folders open/current
- Tests:
  - Unit tests: discovery, error normalization, flag handling
  - Integration tests (jest) targeting a running dev server (behind a tag)

Deliverables:
- pasteflow status
- pasteflow workspaces list|get|create
- pasteflow folders open|current
- Docs: quick start, examples

Phase B — CRUD Expansion (1 week)
- Workspaces: update|delete|rename|load
- Instructions: list|create|update|delete
- Preferences: get|set with JSON parsing (--value and --value@file)
- Improve output formatting (tables, color)
- Tests: route coverage for CRUD, conflict handling (409), not found (404)

Deliverables:
- Full CRUD for workspaces and instructions
- Prefs get/set
- Better UX and error messages

Phase C — Files, Tokens, Selection, Content (1–2 weeks)
- Files: info|content (support --out and --raw)
- Tokens: count|backend (support @file)
- Selection: add|remove|clear|list with line-ranges parsing (e.g., "10-20,30-35")
- Content: get (stdout or --out), export (server-side write; --overwrite)
- Tests:
  - Binary-path refusal flows
  - NO_ACTIVE_WORKSPACE guidance
  - Token counting result shape

Deliverables:
- End-to-end headless aggregation pipeline via CLI

Phase D — Advanced: Preview (1–2 weeks)
- preview: start/status/content/cancel with timeouts and human-readable progress
- Tests: timeouts, large results truncation, pagination stubs if needed

Deliverables:
- Advanced commands with stable UX and tested edge cases

Phase E — Polish and Distribution (0.5–1 week)
- Add help, examples, completion hints
- CI: lint/test, cross-platform smoke checks (Windows/macOS/Linux)
- Versioning and release process
- Optional: publish to npm as @pasteflow/cli

--------------------------------------------------------------------------------

6) Technical Design Details

6.1 Project layout (proposed)
- cli/
  - src/
    - index.ts (commander bootstrap)
    - client.ts (axios instance + discovery)
    - commands/
      - status.ts
      - workspaces.ts
      - folders.ts
      - instructions.ts
      - prefs.ts
      - files.ts
      - tokens.ts
      - select.ts
      - content.ts
      - preview.ts
    - util/
      - errors.ts (normalizer)
      - io.ts (readFile, writeFile, @file parsing)
      - output.ts (tables, JSON)
      - parse.ts (line range parsing, numeric ids)
- Root package.json:
  - optional "workspaces" if moving to monorepo style
  - "bin": { "pasteflow": "cli/dist/index.js", "pf": "cli/dist/index.js" } (if single repo release)

6.2 Error normalization mapping
- If HTTP non-2xx and body.error present → print code + message
- Map common codes to guidance:
  - UNAUTHORIZED → “run the app; verify auth.token”
  - NO_ACTIVE_WORKSPACE → suggest folders open/load
  - PATH_DENIED → show allowedPaths via pasteflow status
  - BINARY_FILE → hint using --raw when applicable (for stdout), but server restricts binary reading
- --json mode prints raw response

6.3 Input parsing aids
- @file convention for larger text/JSON payloads
- Line ranges parser:
  - "10-20,30,40-50" → [{start:10,end:20},{start:30,end:30},{start:40,end:50}]
- Absolute path enforcement and normalization at the CLI side for user feedback (server remains source of truth)

6.4 Security and privacy
- Never print token by default
- Respect umask; never modify auth.token
- Avoid writing outside workspace unless server/export endpoint authorizes it
- Telemetry: none by default

--------------------------------------------------------------------------------

7) Risks and Mitigations

- Server not running or port mismatch:
  - CLI prints friendly message, shows how to start app (npm run dev:electron) and where to find port/token
- Platform path quirks:
  - Rely on server’s allow-first PathValidator and consistently use absolute paths; add CLI-side path tips only
- Large outputs (search/content/tree):
  - Default limits; require explicit flags to expand
- Backward compatibility:
  - CLI is a new layer; keep it stable and map to server changes carefully

--------------------------------------------------------------------------------

8) Acceptance Criteria and Milestones

- A: status + core workspaces + folders flows work end-to-end with human and JSON outputs
- B: Full CRUD for workspaces/instructions; prefs get/set; solid error UX
- C: File/info/content; tokens; selection; content/export; e2e test green
- D: Advanced features (preview) usable and documented
- E: Published CLI with versioned releases and docs

--------------------------------------------------------------------------------

9) Appendix — Endpoint to Command Mapping

- /api/v1/status → pasteflow status
- /api/v1/workspaces → pasteflow workspaces list|get|create|update|delete|rename|load
- /api/v1/folders/open|current → pasteflow folders open|current
- /api/v1/instructions → pasteflow instructions list|create|update|delete
- /api/v1/prefs/:key → pasteflow prefs get|set
- /api/v1/files/info|content → pasteflow files info|content
- /api/v1/tokens/count|backend → pasteflow tokens count|backend
- /api/v1/files/select|deselect|clear|selected → pasteflow select add|remove|clear|list
- /api/v1/content, /api/v1/content/export → pasteflow content get|export
- /api/v1/preview/* → pasteflow preview *

--------------------------------------------------------------------------------

Decision: CRUD via CLI is appropriate and recommended. The CLI will be a thin, user-friendly wrapper over the existing HTTP API, preserving server-side validations and error normalization, and improving developer ergonomics for both quick tasks and automation scripts.