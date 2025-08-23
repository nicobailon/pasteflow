# Phase 4 — Preview Pack, File Tree, and Search Plan — Meta Prompt for LLM Coding Agent

Context and alignment
- Based on [CLI-INTEGRATION-PRD-REVISED.md](CLI-INTEGRATION-PRD-REVISED.md:1), [PHASE1-FOUNDATION-HTTP-API-PLAN.md](docs/PHASE1-FOUNDATION-HTTP-API-PLAN.md:1), [PHASE2-CONTENT-OPERATIONS-PLAN.md](docs/PHASE2-CONTENT-OPERATIONS-PLAN.md:1), [PHASE3-SELECTION-MANAGEMENT-PLAN.md](docs/PHASE3-SELECTION-MANAGEMENT-PLAN.md:1).
- Builds on implemented server modules: [api-server.ts](src/main/api-server.ts:1), [workspace-context.ts](src/main/workspace-context.ts:1), [selection-service.ts](src/main/selection-service.ts:1), [content-aggregation.ts](src/main/content-aggregation.ts:1), [export-writer.ts](src/main/export-writer.ts:1), [file-service.ts](src/main/file-service.ts:1), [path-validator.ts](src/security/path-validator.ts:1), [error-normalizer.ts](src/main/error-normalizer.ts:1), [token-service-main.ts](src/services/token-service-main.ts:1).

Scope and goals (Phase 4)
- Preview Pack orchestration via main↔renderer IPC proxy, exposed over HTTP.
- File tree APIs with in-memory index for performance.
- Workspace search APIs (path-only and content search) with safe limits.
- Database logging tables for API and preview job audit trails.

Non-goals
- No renderer UI changes beyond IPC handlers required for proxying.
- No long-lived background indexing daemons; indexing is per-workspace and on-demand with invalidation hooks.
- No persistence of file indices in DB; memory-only per PRD.

Architecture overview and decisions
- Adopt main-process in-memory FileIndexCache to support tree and search (PRD Phase 4 Option A).
- Keep allFiles ephemeral and never persist to DB (affirmed by PRD lines 233-264).
- Introduce a PreviewController with job store and a RendererPreviewProxy to relay IPC to renderer.
- Extend REST API in [api-server.ts](src/main/api-server.ts:1) with preview, tree, search, and logging endpoints.
- Reuse path safety, token counting, and formatting invariants from prior phases.

New modules (main process)
- [src/main/file-index.ts](src/main/file-index.ts:1) (NEW): FileIndexCache; builds and caches FileData[] per workspace. Supports build(), get(), invalidate(), searchPath(term).
- [src/main/search-service.ts](src/main/search-service.ts:1) (NEW): High-level search across index; optional content scan for text files using [readTextFile()](src/main/file-service.ts:127).
- [src/main/preview-proxy.ts](src/main/preview-proxy.ts:1) (NEW): RendererPreviewProxy to send/receive IPC messages with correlation IDs.
- [src/main/preview-controller.ts](src/main/preview-controller.ts:1) (NEW): Orchestrates preview jobs: [startPreview()](src/main/preview-controller.ts:1), [getStatus()](src/main/preview-controller.ts:1), [getResult()](src/main/preview-controller.ts:1), [cancel()](src/main/preview-controller.ts:1).
- [src/main/db/database-logs.ts](src/main/db/database-logs.ts:1) (NEW): Prepared statements and APIs for CLI/API log entries.

Data models
- Preview job: 
  - id: string (UUID)
  - state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  - requestedAt, startedAt?, finishedAt?, durationMs?
  - options: { includeTrees?: boolean; maxFiles?: number; maxBytes?: number; prompt?: string }
  - result?: { content: string; tokenCount: number; fileCount: number }
  - error?: { code: ApiErrorCode; message: string }
- Log entry:
  - id, timestamp, category: 'api' | 'preview', action, status, durationMs, details JSON

API additions
- Preview
  - POST /api/v1/preview/start
  - GET  /api/v1/preview/status/:id
  - GET  /api/v1/preview/content/:id
  - POST /api/v1/preview/cancel/:id
- File tree
  - GET  /api/v1/files/tree
  - POST /api/v1/files/reindex
- Search
  - POST /api/v1/search
- Logs
  - GET  /api/v1/logs (dev-only; optional)

Zod schemas (express-style)
- PreviewStartBody: { includeTrees?: boolean; maxFiles?: number; maxBytes?: number; prompt?: string }
- PreviewIdParam: { id: string }
- FilesTreeQuery: { mode?: 'complete'|'selected'|'selected-with-roots'; depth?: number; limit?: number }
- FilesReindexBody: { full?: boolean }
- SearchBody: { term: string; isRegex?: boolean; caseSensitive?: boolean; includeContent?: boolean; pathOnly?: boolean; limit?: number; maxFileBytes?: number }
- LogsQuery: { limit?: number; category?: 'api'|'preview' }

Error catalog (Phase 4 additions)
- PREVIEW_NOT_FOUND
- PREVIEW_TIMEOUT
- INDEX_NOT_READY
- SEARCH_TOO_BROAD

Security and validation
- Enforce Authorization header via [AuthManager](src/main/auth-manager.ts:1) for all new endpoints.
- Require active workspace and allowedPaths for preview/tree/search; respond NO_ACTIVE_WORKSPACE otherwise via [toApiError()](src/main/error-normalizer.ts:1).
- Validate all input with Zod; deny excessive limits with VALIDATION_ERROR.
- For content search, restrict to UTF-8 text, respect [FILE_PROCESSING.MAX_FILE_SIZE_BYTES](src/constants/app-constants.ts:1) and [readTextFile()](src/main/file-service.ts:127).
- Never persist index/preview content; only logs go to DB.

Preview pack orchestration
- Main components:
  - [RendererPreviewProxy](src/main/preview-proxy.ts:1): wraps Electron IPC to/from renderer/worker with channels 'cli-pack-start', 'cli-pack-status', 'cli-pack-content'.
  - [PreviewController](src/main/preview-controller.ts:1): owns job map and lifecycle; integrates with [getMainTokenService()](src/services/token-service-main.ts:1) for token counts post-assembly.
- Flow:
  1) HTTP POST /preview/start → [startPreview()](src/main/preview-controller.ts:1) creates job, calls proxy.start(correlationId, options).
  2) Renderer processes and emits progress → proxy emits to controller; controller updates job.state and timestamps; logs via [database-logs.ts](src/main/db/database-logs.ts:1).
  3) On completion, controller assembles content (if renderer sends structured parts) or accepts content payload, counts tokens, stores result in-memory only.
  4) Clients poll /preview/status/:id and fetch /preview/content/:id when state is SUCCEEDED.
  5) /preview/cancel/:id sends cancel to renderer; marks job CANCELLED on ack or timeout.
- Timeouts:
  - Job hard timeout (default 120s). If exceeded → state=FAILED with PREVIEW_TIMEOUT.
- Size caps:
  - Apply maxBytes option; cap content length before token counting. TokenService will fall back to 'estimate' if too large.

Pseudocode (preview endpoints)
- POST /api/v1/preview/start
  - Validate body; ensure workspace; id = crypto.randomUUID()
  - controller.startPreview(id, options) → returns { id }
  - return ok({ id })
- GET /api/v1/preview/status/:id
  - const job = controller.getStatus(id); if !job → 404 PREVIEW_NOT_FOUND; else ok(job)
- GET /api/v1/preview/content/:id
  - const res = controller.getResult(id); if !res → 404 PREVIEW_NOT_FOUND; else ok(res)
- POST /api/v1/preview/cancel/:id
  - controller.cancel(id); return ok(true)

File index and tree
- [FileIndexCache](src/main/file-index.ts:1)
  - build(folderPath, { fullScan?: boolean, exclusionPatterns?: string[] }): Promise<FileData[]>
  - get(): FileData[] | null
  - invalidate(): void
  - searchPath(term, opts): returns matched file infos (path-only search)
- Rebuild triggers:
  - On /workspaces/:id/load and /folders/open → call [setAllowedWorkspacePaths()](src/main/workspace-context.ts:1) and index.invalidate()
  - POST /files/reindex can force a rebuild (full or incremental TBD)
- GET /files/tree
  - Resolve mode and depth; if index missing or stale → build() on demand
  - Return tree nodes: { path, name, isDirectory, size?, mtimeMs?, children? } with limit enforcement
- Performance:
  - Walk using ignore filter [loadGitignore()](src/utils/ignore-utils.ts:13); batch fs ops; yield to event loop on large folders

Search service
- Path-only search:
  - Uses index.searchPath(term, { isRegex, caseSensitive, limit })
- Content search (opt-in via includeContent=true):
  - Iterate over index files filtered to text; read via [readTextFile()](src/main/file-service.ts:127)
  - Scan line-by-line; return matches with { path, line, preview }
  - Enforce maxFileBytes per file and overall match limit; return VALIDATION_ERROR or SEARCH_TOO_BROAD when exceeded

Pseudocode (tree/search endpoints)
- GET /api/v1/files/tree
  - Validate query; ensure workspace; ensure index; ok({ nodes, total, mode, depth })
- POST /api/v1/files/reindex
  - Validate body; index.invalidate(); await index.build(...); ok({ rebuilt: true, fileCount })
- POST /api/v1/search
  - Validate body; ensure workspace; run path-only or content search; ok({ matches, truncated })

Database logging
- New table (SQLite)
  - CREATE TABLE cli_logs(id TEXT PRIMARY KEY, ts INTEGER, category TEXT, action TEXT, status TEXT, duration_ms INTEGER, details TEXT);
  - CREATE INDEX idx_cli_logs_ts ON cli_logs(ts);
- Methods in [database-logs.ts](src/main/db/database-logs.ts:1):
  - [insertLog()](src/main/db/database-logs.ts:1), [listLogs()](src/main/db/database-logs.ts:1), [pruneLogs()](src/main/db/database-logs.ts:1)
- Usage:
  - Log preview lifecycle, API calls (optionally behind config)

API server integration
- Register routes in [api-server.ts](src/main/api-server.ts:1):
  - /preview/* using [PreviewController](src/main/preview-controller.ts:1)
  - /files/tree and /files/reindex using [FileIndexCache](src/main/file-index.ts:1)
  - /search using [search-service.ts](src/main/search-service.ts:1)
  - /logs (optional, dev-only) using [database-logs.ts](src/main/db/database-logs.ts:1)
- Ensure consistent response shaping via ok()/toApiError()

Request/Response shapes (canonical)
- Preview status
  - { data: { id, state, requestedAt, startedAt?, finishedAt?, durationMs?, error? } }
- Preview content
  - { data: { id, content, tokenCount, fileCount } }
- Files tree
  - { data: { nodes: TreeNode[], total: number, mode: string, depth: number } }
- Search
  - { data: { matches: Array<{ path: string; line?: number; preview?: string }>, truncated: boolean } }

Testing plan
- Unit tests
  - [file-index.ts](src/main/file-index.ts:1): build/invalidate depth limits, ignore patterns
  - [search-service.ts](src/main/search-service.ts:1): regex/case, path-only vs content, caps
  - [preview-controller.ts](src/main/preview-controller.ts:1): lifecycle, timeout, cancel
  - [database-logs.ts](src/main/db/database-logs.ts:1): insert/list/prune
- Integration tests (main process)
  - Preview endpoints with FakeRendererPreviewProxy that simulates success/failure/timeout
  - Files tree on temp workspace, verify nodes, depth, mode
  - Search path-only and content over sample files, enforce limits
  - Logs endpoint returns recent entries when enabled
- Performance/regression
  - Large directory index runtime bounds
  - Content search respects size caps and yields to event loop

Implementation steps (day-by-day)
- Day 1
  - Implement [file-index.ts](src/main/file-index.ts:1) with unit tests; integrate invalidate() on workspace load
  - Add [search-service.ts](src/main/search-service.ts:1) path-only, with unit tests
- Day 2
  - Implement [preview-proxy.ts](src/main/preview-proxy.ts:1) and [preview-controller.ts](src/main/preview-controller.ts:1) with job store and FakeRenderer for tests
  - Add preview HTTP routes in [api-server.ts](src/main/api-server.ts:1) with Zod schemas
- Day 3
  - Implement content search in [search-service.ts](src/main/search-service.ts:1) and /search API
  - Implement /files/tree and /files/reindex routes
- Day 4
  - Add [database-logs.ts](src/main/db/database-logs.ts:1) and wire logging into preview and API (opt-in)
  - Integration tests for all new endpoints; smoke test with ephemeral port
- Day 5
  - Documentation updates and CLI examples; fix coverage gaps; stabilize timeouts

CLI guidance (to be implemented in CLI repo)
- Preview
  - pasteflow preview start --include-trees --max-files 200 --max-bytes 200000
  - pasteflow preview status --id <jobId>
  - pasteflow preview content --id <jobId>
  - pasteflow preview cancel --id <jobId>
- File tree
  - pasteflow files tree --mode complete --depth 3 --limit 500
  - pasteflow files reindex --full
- Search
  - pasteflow search --term "useEffect" --case-sensitive
  - pasteflow search --term "TODO" --path-only
  - pasteflow search --term "class\\s+\\w+" --regex --include-content --limit 50

Completion criteria (Phase 4)
- All new endpoints implemented with Zod validation and auth
- Preview pack flow operational via IPC proxy; jobs observable and cancelable
- File index is memory-only, rebuilt on demand, and never persisted
- Search supports path-only and content with strict caps and pruning
- Logging table present and used for preview lifecycle
- Test suite covers unit/integration/performance; no regressions to Phases 1–3

Appendix: Key cross-references
- API server base: [api-server.ts](src/main/api-server.ts:1)
- Selection service: [applySelect()](src/main/selection-service.ts:145), [applyDeselect()](src/main/selection-service.ts:190)
- Aggregation helper: [aggregateSelectedContent()](src/main/content-aggregation.ts:1)
- Export writer: [writeExport()](src/main/export-writer.ts:1)
- File ops: [validateAndResolvePath()](src/main/file-service.ts:49), [readTextFile()](src/main/file-service.ts:127)
- Path safety: [getPathValidator()](src/security/path-validator.ts:108)
- Error helpers: [ok()](src/main/error-normalizer.ts:25), [toApiError()](src/main/error-normalizer.ts:21)
- Token service: [getMainTokenService()](src/services/token-service-main.ts:1)
## Triple Verification Report and Revisions (REVISED)

This section records three complete verification passes over the Phase 4 plan against the current codebase and PRD, followed by concrete revisions to the plan for full alignment and implementation accuracy.

Verification sources
- Server and middleware:
  - [PasteFlowAPIServer](src/main/api-server.ts:60), [startAsync()](src/main/api-server.ts:95), [getPort()](src/main/api-server.ts:135), [registerRoutes()](src/main/api-server.ts:149)
  - [AuthManager](src/main/auth-manager.ts:6)
  - [ok()](src/main/error-normalizer.ts:25), [toApiError()](src/main/error-normalizer.ts:21), [ApiErrorCode](src/main/error-normalizer.ts:1)
- Path safety and workspace context:
  - [getAllowedWorkspacePaths()](src/main/workspace-context.ts:10), [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6)
  - [getPathValidator()](src/security/path-validator.ts:108), [PathValidator.validatePath()](src/security/path-validator.ts:29)
  - [validateAndResolvePath()](src/main/file-service.ts:49)
- File ops and aggregation:
  - [statFile()](src/main/file-service.ts:77), [readTextFile()](src/main/file-service.ts:127)
  - [aggregateSelectedContent()](src/main/content-aggregation.ts:176)
  - [getSelectedFilesContent()](src/utils/content-formatter.ts:275)
- Selection service and export:
  - [applySelect()](src/main/selection-service.ts:145), [applyDeselect()](src/main/selection-service.ts:190)
  - [writeExport()](src/main/export-writer.ts:10)
- Token service:
  - [getMainTokenService()](src/services/token-service-main.ts:109), [TokenService.countTokens()](src/services/token-service.ts:48), [TokenService.getActiveBackend()](src/services/token-service.ts:169)
- Existing endpoints to mirror patterns:
  - Files/info: [GET /api/v1/files/info](src/main/api-server.ts:345)
  - Files/content: [GET /api/v1/files/content](src/main/api-server.ts:374)
  - Folders/current|open: [GET /folders/current](src/main/api-server.ts:450), [POST /folders/open](src/main/api-server.ts:463)
  - Selection: [POST /files/select](src/main/api-server.ts:503), [POST /files/deselect](src/main/api-server.ts:563), [POST /files/clear](src/main/api-server.ts:615), [GET /files/selected](src/main/api-server.ts:639)
  - Aggregation: [GET /content](src/main/api-server.ts:661), [POST /content/export](src/main/api-server.ts:702)
- Tests and patterns:
  - Day-3 tests: [api-server.test.ts](src/main/__tests__/api-server.test.ts:1)
  - Phase-3 tests: [api-server-phase3.test.ts](src/main/__tests__/api-server-phase3.test.ts:1), [content-aggregation.test.ts](src/main/__tests__/content-aggregation.test.ts:1), [selection-service.test.ts](src/main/__tests__/selection-service.test.ts:1)
  - Test helpers: [waitForPort()](src/main/__tests__/api-server.test.ts:204)

Pass 1 — Endpoint and middleware alignment
- Auth-first middleware: Verified in [constructor](src/main/api-server.ts:65); Phase 4 endpoints MUST keep this ordering (auth before JSON parser) and reuse the existing JSON-parse error normalization already installed at [lines 77-85](src/main/api-server.ts:77).
- Validation via Zod: Verified pattern at route definitions (e.g., [createWorkspaceBody](src/main/api-server.ts:21), [selectionBody](src/main/api-server.ts:45)); Phase 4 routes will define equivalent zod schemas for preview/tree/search/logs.
- Error shaping: All responses must use [ok()](src/main/error-normalizer.ts:25) for success and [toApiError()](src/main/error-normalizer.ts:21) for errors. Existing 4xx/5xx mappings in Phase 2/3 are consistent and will be mirrored.
- Active workspace enforcement: Checked across Phase 2/3 (e.g., [files/info](src/main/api-server.ts:350-356), [selection](src/main/api-server.ts:508-517)), using [getAllowedWorkspacePaths()](src/main/workspace-context.ts:10). Phase 4 endpoints must reject with NO_ACTIVE_WORKSPACE when allowedPaths is empty.

Pass 2 — Data model and utility alignment
- File model and selections: Phase 4 must continue to exchange only references in state ({ path, lines? }) aligned with [SelectedFileReference](src/types/file-types.ts:76). Do not persist file index or content.
- Tree modes and sorting: Phase 4 tree endpoints must honor [FileTreeMode](src/types/file-types.ts:181) and follow the same ordering semantics as the formatter pipeline used by [getSelectedFilesContent()](src/utils/content-formatter.ts:275).
- Binary and size checks: Content-based operations must continue to respect binary identification and caps via [statFile()](src/main/file-service.ts:77) and [readTextFile()](src/main/file-service.ts:127).

Pass 3 — Testing and integration patterns
- Server lifecycle and port binding: Use the same ephemeral binding pattern and polling via [startAsync()](src/main/api-server.ts:95) and [waitForPort()](src/main/__tests__/api-server.test.ts:204).
- Test density and style: Mirror Phase 2/3 tests with multiple assertions per test, no try/catch swallowing, and E2E requests via Node http. Provide FakeRendererPreviewProxy for preview endpoints similar in spirit to FakeDatabaseBridge used in [api-server-phase3.test.ts](src/main/__tests__/api-server-phase3.test.ts:11).
- Path safety in tests: Continue to prime security context using [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6) and [getPathValidator()](src/security/path-validator.ts:108) in unit-level tests (e.g., [content-aggregation.test.ts](src/main/__tests__/content-aggregation.test.ts:23)).

Revisions and clarifications to Phase 4 plan

1) Error catalog extensions (explicit)
- Extend [ApiErrorCode](src/main/error-normalizer.ts:1) with:
  - 'PREVIEW_NOT_FOUND' — 404 for unknown job
  - 'PREVIEW_TIMEOUT' — 504 when a job exceeds the hard timeout
  - 'INDEX_NOT_READY' — 503 when index is rebuilding/unavailable (include `Retry-After: 1`)
  - 'SEARCH_TOO_BROAD' — 400 when query exceeds configured caps (e.g., regex too large, match limit exceeded)
- Phase 4 routes must map:
  - PREVIEW_NOT_FOUND → 404
  - PREVIEW_TIMEOUT → 504
  - INDEX_NOT_READY → 503
  - SEARCH_TOO_BROAD → 400
- Continue to reuse existing codes where applicable: NO_ACTIVE_WORKSPACE (400), PATH_DENIED (403), VALIDATION_ERROR (400), INTERNAL_ERROR (500).

2) File Tree response shape (align to existing TreeNode semantics)
- Define an API response node shape that matches the spirit of [TreeNode](src/types/file-types.ts:81) while remaining transport-friendly:
  - type TreeNodeResponse = { path: string; name: string; type: 'file' | 'directory'; size?: number; mtimeMs?: number; children?: TreeNodeResponse[] }
- Update the plan’s Files Tree response to use type with 'type' instead of 'isDirectory' for consistency with [TreeNode.type](src/types/file-types.ts:85).

3) Security and path validation invariants (carry-over)
- All Phase 4 endpoints must require an active workspace and derive allowedPaths from [getAllowedWorkspacePaths()](src/main/workspace-context.ts:10).
- Any path materialized during tree or search must be validated via [getPathValidator().validatePath](src/security/path-validator.ts:29) or obtained from trusted sources (scans rooted at an already-validated workspace folder).
- Content search must read files only via [readTextFile()](src/main/file-service.ts:127) to reuse size/binary protections.

4) FileIndexCache correctness and invalidation
- Index must be memory-only and per-active-workspace; never persisted (consistent with Phase 3 aggregation and PRD guidance).
- Invalidate and rebuild triggers:
  - On [POST /api/v1/workspaces/:id/load](src/main/api-server.ts:341) and [POST /api/v1/folders/open](src/main/api-server.ts:463): invalidate index; build lazily upon first tree/search request.
  - Provide [POST /api/v1/files/reindex] to force rebuild.
- Implementation sketch:
  - file-index.ts: class FileIndexCache { build(folderPath, opts); get(); invalidate(); searchPath(term, opts) }
  - Filtering uses [loadGitignore()](src/utils/ignore-utils.ts:13) with userPatterns passed from workspace state when available.

5) Search semantics and protections
- POST /api/v1/search body:
  - { term: string; isRegex?: boolean; caseSensitive?: boolean; includeContent?: boolean; pathOnly?: boolean; limit?: number; maxFileBytes?: number }
- Protections:
  - Cap regex length (e.g., ≤ 256 chars) and total matches (default limit 200).
  - For content search, cap per-file bytes (default maxFileBytes 256 KiB) and total scanned files (default 1000), falling back to truncated results with SEARCH_TOO_BROAD.
  - Always respect binary and size checks in [readTextFile()](src/main/file-service.ts:127).
- Return { data: { matches, truncated: boolean } } with stable ordering (e.g., path asc).

6) Preview orchestration clarifications
- Channels: 'cli-pack-start', 'cli-pack-status', 'cli-pack-content' via [RendererPreviewProxy](src/main/preview-proxy.ts:1) (new).
- [PreviewController](src/main/preview-controller.ts:1) (new) responsibilities:
  - Job lifecycle with in-memory store; timestamps and durationMs tracking.
  - Hard timeout (default 120s) → PREVIEW_TIMEOUT (504).
  - Token count with [getMainTokenService()](src/services/token-service-main.ts:109) after content assembly.
- Endpoints:
  - POST /api/v1/preview/start → ok({ id })
  - GET /api/v1/preview/status/:id → ok(job) or 404 PREVIEW_NOT_FOUND
  - GET /api/v1/preview/content/:id → ok({ id, content, tokenCount, fileCount }) or 404
  - POST /api/v1/preview/cancel/:id → ok(true) (idempotent)

7) API route registration order and patterns
- Append Phase 4 routes under existing Phase 3 registrations in [registerRoutes()](src/main/api-server.ts:149), preserving:
  - Auth-first
  - Zod body/param schemas colocated at top of file (consistent with [lineRange](src/main/api-server.ts:43) et al.)
  - ok()/toApiError() response discipline and consistent HTTP status codes.

8) Tests to add (unit + integration)
- Unit:
  - file-index.test.ts — build/invalidate; ignores; depth/limit
  - search-service.test.ts — regex/case; caps; truncation; binary/size skips
  - preview-controller.test.ts — lifecycle; timeout; cancel; token counting
  - database-logs.test.ts — insert/list/prune behavior
- Integration (main process):
  - api-server-phase4.test.ts:
    - preview: start/status/content/cancel happy path and timeout
    - files/tree: complete/selected-with-roots with limits
    - files/reindex: invalidation and rebuilt count
    - search: path-only and content search; caps/truncation; NO_ACTIVE_WORKSPACE rejections
- Patterns:
  - Use withTempHome, ephemeral port, and Authorization header as in [api-server.test.ts](src/main/__tests__/api-server.test.ts:214).
  - For preview endpoints, supply a FakeRendererPreviewProxy; avoid tight coupling to renderer code.

9) Logging table integration (optional but recommended)
- Add 'cli_logs' with indices inside DB implementation (new prepared statements), exposing a small wrapper in DatabaseBridge to insert/prune/list. Keep disabled by default or gated by config to avoid perf overhead in tests.

10) Backward compatibility and invariants
- No changes to existing endpoints; Phase 4 only adds new endpoints and modules.
- Preserve invariants:
  - Never persist file indices or aggregated content (Phase 3 discipline).
  - Selection state persists only { path, lines? } as enforced by [applySelect()](src/main/selection-service.ts:145) and [applyDeselect()](src/main/selection-service.ts:190).
  - Error normalization consistency with [ApiErrorCode](src/main/error-normalizer.ts:1).

Canonical updates to plan text (delta)
- Replace all mentions of Files Tree node "isDirectory" with "type: 'file'|'directory'".
- Explicitly list new ApiErrorCode values and HTTP status mappings (see #1).
- Note index invalidation triggers (see #4).
- Add regex/match caps and truncation semantics (see #5).
- Clarify preview timeout mapping to 504 PREVIEW_TIMEOUT (see #6).

This revised Phase 4 plan now mirrors Phase 1–3 patterns and the real codebase. It specifies precise error codes, response shapes, validation rules, and test strategies that match current architecture and coding standards while adding the new features required for Phase 4.