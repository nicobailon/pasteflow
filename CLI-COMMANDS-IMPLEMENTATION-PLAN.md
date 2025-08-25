# PasteFlow CLI Commands — Implementation Plan

Purpose
- Define a concrete plan to add a first‑party command-line interface (CLI) that integrates with PasteFlow's existing HTTP API server for CRUD operations and related automation tasks.
- Assess the current architecture to confirm which capabilities are already exposed via REST and determine appropriateness of surfacing them in CLI form.
- Outline the command taxonomy, user experience goals, integration points, error handling, and a phased development roadmap.
- **REVISED**: Incorporate technical audit findings to ensure production readiness with proper error handling, memory management, and performance optimizations.

Authoritative code references (updated per audit)
- API server and routes: [PasteFlowAPIServer](src/main/api-server.ts:71), [`registerRoutes()`](src/main/api-server.ts:162)
- Electron main boot and server port write: [main.ts](src/main/main.ts:255)
- Auth token management: [AuthManager](src/main/auth-manager.ts:6), [AuthManager.validate()](src/main/auth-manager.ts:16)
- Error normalization: [toApiError()](src/main/error-normalizer.ts:24), [ok()](src/main/error-normalizer.ts:28)
- Security model and path access: [PathValidator](src/security/path-validator.ts:9), [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6), [getAllowedWorkspacePaths()](src/main/workspace-context.ts:10)
- File/Content services: [validateAndResolvePath()](src/main/file-service.ts:49), [statFile()](src/main/file-service.ts:77), [readTextFile()](src/main/file-service.ts:127)
- Aggregation/export: [aggregateSelectedContent()](src/main/content-aggregation.ts:176), [writeExport()](src/main/export-writer.ts:10)
- Preview: [RendererPreviewProxy](src/main/preview-proxy.ts:24), [PreviewController](src/main/preview-controller.ts:29)
- IPC envelopes and schemas (GUI): [main IPC handlers](src/main/main.ts:667), [schemas](src/main/ipc/schemas.ts:1)

--------------------------------------------------------------------------------

1) Architecture Assessment

1.1 What exists today
- HTTP REST API server runs within the Electron main process:
  - Bound to 127.0.0.1 with port selection/scan starting at 5839; see [`startAsync()`](src/main/api-server.ts:108)
  - Writes discovered port to ~/.pasteflow/server.port and manages token at ~/.pasteflow/auth.token
    - Port write: [main.ts](src/main/main.ts:262)
    - Token creation and validation: [AuthManager.validate()](src/main/auth-manager.ts:16)
- Comprehensive endpoints are implemented (fully mapped per audit):
  - Health/status: [`GET /api/v1/status`](src/main/api-server.ts:167) 
  - Workspaces CRUD: [`GET`](src/main/api-server.ts:190), [`POST`](src/main/api-server.ts:200), [`GET :id`](src/main/api-server.ts:215), [`PUT :id`](src/main/api-server.ts:227), [`DELETE :id`](src/main/api-server.ts:239)
  - Workspaces operations: [`POST :id/rename`](src/main/api-server.ts:250), [`POST :id/load`](src/main/api-server.ts:264)
  - Instructions CRUD: [`GET`](src/main/api-server.ts:281), [`POST`](src/main/api-server.ts:297), [`PUT :id`](src/main/api-server.ts:309), [`DELETE :id`](src/main/api-server.ts:321)
  - Preferences: [`GET /prefs/:key`](src/main/api-server.ts:333), [`PUT /prefs/:key`](src/main/api-server.ts:344)
  - File operations: [`GET /files/info`](src/main/api-server.ts:358), [`GET /files/content`](src/main/api-server.ts:387)
  - Token counting: [`POST /tokens/count`](src/main/api-server.ts:438), [`GET /tokens/backend`](src/main/api-server.ts:452)
  - Folder operations: [`POST /folders/open`](src/main/api-server.ts:475), [`GET /folders/current`](src/main/api-server.ts:462)
  - Selection: [`POST /files/select`](src/main/api-server.ts:515), [`POST /files/deselect`](src/main/api-server.ts:574), [`POST /files/clear`](src/main/api-server.ts:627), [`GET /files/selected`](src/main/api-server.ts:650)
  - Content aggregation: [`GET /content`](src/main/api-server.ts:672), [`POST /content/export`](src/main/api-server.ts:713)
  - Preview (async): [`POST /preview/start`](src/main/api-server.ts:773), [`GET /preview/status/:id`](src/main/api-server.ts:798), [`GET /preview/content/:id`](src/main/api-server.ts:812), [`POST /preview/cancel/:id`](src/main/api-server.ts:821)
- Error response model is normalized across routes via [error-normalizer.ts](src/main/error-normalizer.ts:1) and consistently used in handlers.
- Security model relies on allow-first validation relative to the active workspace, using singleton path validator and workspace context:
  - [PathValidator.validatePath()](src/security/path-validator.ts:51)
  - [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6), [getAllowedWorkspacePaths()](src/main/workspace-context.ts:10)
  - Singleton pattern: [getPathValidator()](src/security/path-validator.ts:108)
- IPC layer exists primarily for GUI/renderer interactions (not required for CLI once HTTP is used). IPC handlers also return camelCase shapes and map DB snake_case fields.

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

1.4 Critical API Issues to Address (from Audit)
**These must be fixed before CLI release to ensure production readiness:**

P0 (Critical - Memory Leaks & Stability):
- **Preview listener cleanup**: Memory leak in [PreviewController](src/main/preview-controller.ts:115) - listeners not cleaned on FAILED status
- **Preview job retention**: Completed jobs remain indefinitely in memory without TTL/GC
- **Timer cleanup**: Timeouts not cleared on all terminal states

P1 (High - Core Functionality):
- **Workspace paths auto-init**: Allowed paths not set on startup causing NO_ACTIVE_WORKSPACE errors
- **Content aggregation performance**: Sequential file stats in "complete" mode impacts large repos
- **Missing CLI dependencies**: No commander/axios packages yet present

P2 (Medium - Operational):
- **Error code semantics**: DB_OPERATION_FAILED incorrectly used for filesystem errors
- **API logging**: Minimal logging for debugging/monitoring
- **Token backend consistency**: Response shape inconsistencies

P3 (Low - Polish):
- **Auth token regeneration**: Unexpected rotation on read failures
- **Redundant validation**: Double-checking in files endpoints
- **Exit codes**: Need standardized CLI exit codes for different error classes

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
- Standardized exit codes for scripting:
  - 0: Success
  - 1: General error
  - 2: Validation error (bad input)
  - 3: Authentication failure
  - 4: Resource not found
  - 5: Conflict (e.g., name collision, binary file)
  - 6: Server not running or unreachable

--------------------------------------------------------------------------------

4) Integration Approach

4.1 Transport and discovery
- HTTP client: axios or undici; axios suffices for simplicity and JSON handling
- Read token/port from:
  - ~/.pasteflow/auth.token (required): [AuthManager](src/main/auth-manager.ts:21)
  - ~/.pasteflow/server.port (required): written by main at [main.ts](src/main/main.ts:261)
- Allow overrides via env (PASTEFLOW_TOKEN, PASTEFLOW_PORT) and flags

4.2 Error handling
- On non-2xx: parse { error: { code, message, details? } } per [toApiError()](src/main/error-normalizer.ts:24)
- Display concise messages by default:
  - 401: Unauthorized — re-check token file → exit 3
  - 400: Validation error — echo message/details → exit 2
  - 403: Path denied — show workspace path hint → exit 2
  - 404: Not found — mention resource → exit 4
  - 409: Conflict (binary file or name collision) → exit 5
  - 500: Internal/DB error — suggest checking app logs → exit 1
- Special error codes (from audit):
  - NO_ACTIVE_WORKSPACE: Suggest `pasteflow folders open` or `pasteflow workspaces load` → exit 2
  - BINARY_FILE: Inform user about binary restriction → exit 5
  - FILE_SYSTEM_ERROR (new): Report filesystem issue → exit 1
- In --json mode, print raw error JSON unchanged with appropriate exit code
- Connection errors: Server not running → exit 6 with instructions to start app

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

5) Development Roadmap (Revised with Audit Priorities)

Phase 0 — API Fixes (Must complete before CLI work - 3-5 days)
**Critical P0 fixes to prevent memory leaks and crashes:**
- Fix preview listener cleanup in [PreviewController](src/main/preview-controller.ts:115):
  - Clear timers and unsubscribe listeners on ALL terminal states (FAILED, SUCCEEDED, CANCELLED)
  - Implement job retention policy with TTL or max job count
  - Add dispose() method to centralize cleanup
- Fix workspace paths auto-initialization:
  - On app startup after DB init, read workspace.active
  - If present, call setAllowedWorkspacePaths() to avoid NO_ACTIVE_WORKSPACE errors
- Tests for preview lifecycle and memory management

Phase A — Foundations + P1 Fixes (1 week)
- **P1 API fixes:**
  - Batch file stat operations in content aggregation (Promise.all with chunks)
  - Add maxFiles/maxBytes limits to /content endpoint
  - Fix error codes: Use FILE_SYSTEM_ERROR instead of DB_OPERATION_FAILED for fs errors
- **CLI scaffolding:**
  - Directory: cli/ or packages/cli/
  - Dependencies: commander@11, axios@1 (or undici@6), @types/*
  - Entry point: src/index.ts with commander
  - Add bin in root package.json: "bin": { "pasteflow": "dist/cli.js", "pf": "dist/cli.js" }
  - Build with tsx/tsc; ship as Node (no native deps)
- **Core services:**
  - Discovery service for ~/.pasteflow/server.port and auth.token
  - HTTP client with auth header, timeout, retry logic
  - Error normalizer with exit code mapping
  - Output formatter (tables, JSON, raw)
  - Connection checker with helpful server-not-running message
- **Initial commands:** status, workspaces list/get/create, folders open/current
- **Tests:**
  - Unit tests: discovery, error normalization, exit codes
  - Integration tests with mock server
  - Test NO_ACTIVE_WORKSPACE guidance

Deliverables:
- Fixed preview memory leaks
- Fixed workspace initialization
- pasteflow status (with connection check)
- pasteflow workspaces list|get|create
- pasteflow folders open|current
- Exit code compliance

Phase B — CRUD Expansion + P2 Fixes (1 week)
- **P2 API improvements:**
  - Add debug logging to API routes (behind env flag)
  - Ensure consistent token backend response shape
  - Consider auth token atomic write strategy
- **CLI commands:**
  - Workspaces: update|delete|rename|load
  - Instructions: list|create|update|delete
  - Preferences: get|set with JSON parsing (--value and --value@file)
- **Output improvements:**
  - Tables with proper column alignment
  - Color support (respecting NO_COLOR env)
  - Progress indicators for long operations
- **Tests:** 
  - Route coverage for CRUD operations
  - Conflict handling (409), not found (404)
  - Token backend consistency

Deliverables:
- Full CRUD for workspaces and instructions
- Prefs get/set with proper JSON handling
- Improved error messages and output formatting
- API logging capability

Phase C — Files, Tokens, Selection, Content (1–2 weeks)
- **P3 polish items:**
  - Remove redundant validation in files endpoints
  - Improve auth token read failure handling
- **CLI commands:**
  - Files: info|content (support --out and --raw)
  - Tokens: count|backend (support @file)
  - Selection: add|remove|clear|list with line-ranges parsing
  - Content: get (stdout or --out), export (server-side write; --overwrite)
- **Performance optimizations:**
  - Implement streaming for large file content
  - Add progress bars for multi-file operations
- **Tests:**
  - Binary file handling and rejection
  - NO_ACTIVE_WORKSPACE error guidance
  - Large file handling
  - Export overwrite semantics

Deliverables:
- Complete headless aggregation pipeline via CLI
- Efficient handling of large codebases
- Full test coverage for edge cases

Phase D — Advanced: Preview + Final P3 Items (1 week)
- **Preview commands:**
  - start: with progress indicator and timeout handling
  - status: poll with backoff strategy
  - content: stream large results
  - cancel: clean termination
- **Final polish:**
  - Shell completion scripts
  - Man page generation
  - --help improvements with examples
- **Tests:** 
  - Preview timeout scenarios
  - Job cleanup verification
  - Large result handling

Deliverables:
- Robust preview commands with proper lifecycle management
- Complete documentation and help system

Phase E — Distribution & Monitoring (3-4 days)
- **Release preparation:**
  - CI/CD pipeline setup
  - Cross-platform testing (Windows/macOS/Linux)
  - npm package configuration
  - Homebrew formula (optional)
- **Monitoring additions:**
  - Error reporting integration
- **Documentation:**
  - README with quickstart
  - API documentation
  - Troubleshooting guide
  - Migration guide for GUI users

Deliverables:
- Published CLI package (@pasteflow/cli)
- Complete documentation suite
- Distribution channels configured

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
- Map common codes to guidance and exit codes:
  - UNAUTHORIZED → "run the app; verify auth.token" → exit 3
  - NO_ACTIVE_WORKSPACE → suggest folders open/load → exit 2
  - PATH_DENIED → show allowedPaths via pasteflow status → exit 2
  - BINARY_FILE → explain binary restriction → exit 5
  - FILE_SYSTEM_ERROR (new) → filesystem issue → exit 1
  - NOT_FOUND → resource doesn't exist → exit 4
  - CONFLICT → name/state conflict → exit 5
  - DB_OPERATION_FAILED → database error → exit 1
  - VALIDATION_ERROR → invalid input → exit 2
  - INTERNAL_ERROR → unexpected error → exit 1
- Connection failures → "Server not running. Start with: npm run dev:electron" → exit 6
- --json mode prints raw response with same exit codes

6.3 Input parsing aids
- @file convention for larger text/JSON payloads
- Line ranges parser:
  - "10-20,30,40-50" → [{start:10,end:20},{start:30,end:30},{start:40,end:50}]
- Absolute path enforcement and normalization at the CLI side for user feedback (server remains source of truth)

6.4 Security and privacy
- Never print token by default
- Respect umask; never modify auth.token
- Avoid writing outside workspace unless server/export endpoint authorizes it

6.5 Required API Fixes (from Audit)

Preview Controller Memory Management:
```typescript
// In PreviewController.handleStatus() at line 115:
if (status === 'FAILED' || status === 'SUCCEEDED' || status === 'CANCELLED') {
  this.clearTimer(jobId);
  // ADD: Cleanup listeners
  const job = this.jobs.get(jobId);
  if (job?.cleanup) {
    job.cleanup(); // Unsubscribe all listeners
  }
  // ADD: Remove from map after delay or implement LRU
  setTimeout(() => this.jobs.delete(jobId), 5 * 60 * 1000); // 5 min retention
}
```

Workspace Path Initialization:
```typescript
// In main.ts after DB init (line ~255):
app.whenReady().then(async () => {
  // ... existing DB init ...
  
  // ADD: Auto-init allowed paths
  const activeWorkspace = await db.getActiveWorkspace();
  if (activeWorkspace?.folder) {
    setAllowedWorkspacePaths([activeWorkspace.folder]);
    getPathValidator([activeWorkspace.folder]);
  }
  
  // ... rest of startup
});
```

Content Aggregation Performance:
```typescript
// In buildAllFiles() at line 96:
// Replace sequential stats with batched operations
const BATCH_SIZE = 32;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  const stats = await Promise.all(
    batch.map(file => fs.stat(file).catch(() => null))
  );
  // Process batch results
  await new Promise(resolve => setImmediate(resolve)); // Yield to event loop
}
```

Error Code Corrections:
```typescript
// In statFile() and readTextFile() error handlers:
// Replace DB_OPERATION_FAILED with:
return toApiError('FILE_SYSTEM_ERROR', `Filesystem error: ${error.message}`);
```

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

Phase 0 (API Fixes - MUST PASS before CLI work):
- ✅ Preview memory leaks fixed - no listener/timer leaks on any terminal state
- ✅ Job retention implemented - completed jobs cleaned up after TTL
- ✅ Workspace paths auto-init - no NO_ACTIVE_WORKSPACE on restart with active workspace
- ✅ All P0 fixes verified with tests

Phase A (Foundations):
- ✅ Server connection detection with helpful error messages
- ✅ Exit codes match documented standards (0-6)
- ✅ status command shows server health, workspace, allowed paths
- ✅ workspaces list/get/create work with proper error handling
- ✅ folders open/current initialize workspace correctly
- ✅ P1 performance fixes (batched stats, content limits)

Phase B (CRUD):
- ✅ Full CRUD for workspaces/instructions with conflict handling
- ✅ Preferences get/set with JSON validation
- ✅ Table output formatting with alignment
- ✅ Color support respecting NO_COLOR
- ✅ P2 improvements (logging, token consistency)

Phase C (Files/Content):
- ✅ File info/content with binary detection
- ✅ Token counting with consistent backend reporting
- ✅ Selection management with line ranges
- ✅ Content aggregation/export with progress
- ✅ Large file handling without blocking

Phase D (Preview):
- ✅ Preview start/status/content/cancel with proper lifecycle
- ✅ Progress indicators and timeout handling
- ✅ Shell completions and help system
- ✅ All P3 polish items completed

Phase E (Release):
- ✅ Published to npm as @pasteflow/cli
- ✅ Cross-platform tested (Windows/macOS/Linux)
- ✅ Complete documentation suite
- ✅ CI/CD pipeline operational

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
