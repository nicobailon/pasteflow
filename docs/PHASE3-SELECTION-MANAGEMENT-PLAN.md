# Phase 3 — Selection Management Plan
This document defines the Phase 3 implementation plan for Selection Management (workspace state mutations for file selection, content aggregation, and export), aligned with the PRD and the completed Phase 1 and Phase 2 infrastructure.

Scope and Goals (Phase 3)
- Primary goals
  - Add HTTP endpoints for:
    - POST /api/v1/files/select
    - POST /api/v1/files/deselect
    - POST /api/v1/files/clear
    - GET /api/v1/files/selected
    - GET /api/v1/content
    - POST /api/v1/content/export
  - Enforce path safety (allow-first PathValidator) and active workspace constraints.
  - Keep selection state in DB WorkspaceState; never persist allFiles indices.
  - Provide deterministic, size-safe content aggregation.
- Non-goals
  - Preview pack generation, file tree search; deferred to Phase 4+.
  - Any renderer coupling for content assembly; use main-process services only.

Baseline: Verified Code and Architecture
- HTTP server and middleware: [src/main/api-server.ts](src/main/api-server.ts:1)
  - Auth-first, JSON parsing, error normalization via [ok()](src/main/error-normalizer.ts:25) and [toApiError()](src/main/error-normalizer.ts:21)
- Path validation allow-first logic: [PathValidator.validatePath()](src/security/path-validator.ts:29)
- Active workspace preference and allowedPaths sync: [setAllowedWorkspacePaths()](src/main/workspace-context.ts:6), [getPathValidator()](src/security/path-validator.ts:108)
- File ops helpers for single-file checks: [validateAndResolvePath()](src/main/file-service.ts:49), [statFile()](src/main/file-service.ts:77), [readTextFile()](src/main/file-service.ts:127)
- Workspace update-by-id support: [DatabaseBridge.updateWorkspaceById](src/main/db/database-bridge.ts:162), [PasteFlowDatabase.updateWorkspaceById](src/main/db/database-implementation.ts:395)
- Content formatter for aggregation: [getSelectedFilesContent()](src/utils/content-formatter.ts:275) and [getFileType()](src/utils/content-formatter.ts:328)

Corrections vs earlier assumptions
- Selection endpoints must never accept paths outside allowedPaths (return PATH_DENIED).
- Content aggregation must not require persisted allFiles; use on-demand scanning for Phase 3.
- Export path must be constrained to active workspace (PATH_DENIED otherwise).

API Additions (Phase 3)
1) POST /api/v1/files/select
- Body:
  - { items: Array<{ path: string; lines?: Array<{ start: number; end: number }> }> }
- Response:
  - 200: { data: true }
  - 400: VALIDATION_ERROR on schema error or empty items
  - 400: NO_ACTIVE_WORKSPACE if no active workspace
  - 403: PATH_DENIED if any item is outside allowedPaths
  - 404: FILE_NOT_FOUND if any item path does not exist on disk (optional strictness, see Behavior)
- Behavior:
  - Validate each path via [validateAndResolvePath()](src/main/file-service.ts:49).
  - Option Strictness: stat file to return 404 for missing files; if performance sensitive, allow lazy existence check at aggregation time with clear error; Phase 3 adopts strict existence check on select to fail early.
  - Merge strategy:
    - If file already selected without lines and new item has lines → keep no-lines (meaning whole file).
    - If file selected with lines and new item has lines → merge contiguous/overlapping ranges, clamp to positive integers, enforce start <= end.
    - If file selected with lines and new item has no lines → upgrade to whole file (drop ranges).
  - Persist new WorkspaceState via [updateWorkspaceById](src/main/db/database-bridge.ts:162).

2) POST /api/v1/files/deselect
- Body:
  - { items: Array<{ path: string; lines?: Array<{ start: number; end: number }> }> }
- Response:
  - 200: { data: true }
  - Same 4xx/5xx handling as select
- Behavior:
  - If no lines provided: remove the file from selectedFiles.
  - If lines provided:
    - If file was whole-file selected: convert to lines and subtract given ranges (or remove entirely if subtraction covers all).
    - If file selected with lines: subtract given ranges (split remaining ranges as needed), and drop file entry if no ranges remain.

3) POST /api/v1/files/clear
- Body: {}
- Response: 200 { data: true }
- Behavior: set selectedFiles = [] for active workspace.

4) GET /api/v1/files/selected
- Response:
  - 200: { data: Array<{ path: string; lines?: Array<{ start: number; end: number }> }> }
- Behavior: return current WorkspaceState.selectedFiles in camelCase.

5) GET /api/v1/content
- Query:
  - none (uses active workspace)
- Response:
  - 200: { data: { content: string; fileCount: number; tokenCount: number } }
  - 400: NO_ACTIVE_WORKSPACE if no active workspace
  - Note: never 403 for stale/invalid selections. During aggregation, entries outside allowedPaths or no longer existing are pruned rather than failing the whole request.
- Behavior:
  - Build ephemeral allFiles in-memory; do NOT persist:
    - If fileTreeMode is "selected" or "selected-with-roots", include only the selected files plus their ancestor directories (sufficient for ASCII tree).
    - If fileTreeMode is "complete", scan the entire workspace folder with gitignore-aware filtering via [loadGitignore()](src/utils/ignore-utils.ts:13) and extension-based skips from [isBinaryExtension()](src/file-ops/filters.ts:31).
  - For each selected file that survives validation:
    - Resolve and persist the sanitized absolute path from [validateAndResolvePath()](src/main/file-service.ts:49).
    - Read UTF-8 text using [readTextFile()](src/main/file-service.ts:127); skip files flagged as binary/special or over-size per [FILE_PROCESSING.MAX_FILE_SIZE_BYTES](src/constants/app-constants.ts:10).
    - Populate FileData with { content, isContentLoaded: true, fileType: [getFileType()](src/utils/content-formatter.ts:328) } for selected files to ensure actual content inclusion (no placeholders).
  - Assemble the final string via [getSelectedFilesContent()](src/utils/content-formatter.ts:275), which internally uses [validateLineSelections()](src/utils/workspace-utils.ts:38) and [extractContentForLines()](src/utils/workspace-utils.ts:80) to honor line ranges.
  - Compute tokenCount via [getMainTokenService().countTokens()](src/services/token-service-main.ts:109); large inputs automatically fall back to "estimate" per [TokenService.countTokens()](src/services/token-service.ts:48).
  - Return content and counts; fileCount equals the number of valid selected files included after pruning.

6) POST /api/v1/content/export
- Body:
  - { outputPath: string; overwrite?: boolean }
- Response:
  - 200: { data: { outputPath: string; bytes: number } }
  - 400: VALIDATION_ERROR on schema error
  - 400: NO_ACTIVE_WORKSPACE if not active
  - 403: PATH_DENIED if outputPath outside workspace
- Behavior:
  - Re-generate content as in GET /api/v1/content.
  - Resolve outputPath with allow-first; require it to be inside workspace.
  - If file exists and overwrite !== true → 400 VALIDATION_ERROR.
  - Write UTF-8; return bytes written.

Security and Validation
- Authorization: enforced by server middleware first, as in Phase 1/2.
- Zod schemas:
  - Select/Deselect item: z.object({ path: z.string().min(1), lines: z.array(z.object({ start: z.number().int().min(1), end: z.number().int().min(1) })).nonempty().optional() })
  - Select/Deselect payload: z.object({ items: z.array(itemSchema).min(1) })
  - Export payload: z.object({ outputPath: z.string().min(1), overwrite: z.boolean().optional() })
- PathValidator:
  - All paths must pass [validateAndResolvePath()](src/main/file-service.ts:49)
  - Re-validate during aggregation to avoid stale state exploits
- Size and memory controls:
  - Measure aggregated content size in bytes; do not reject solely due to size. For token counting, [TokenService.countTokens()](src/services/token-service.ts:48) already falls back to "estimate" when text exceeds its configured maxTextSize. If a hard cap is desired later, gate behind a constant and return VALIDATION_ERROR with a clear message.

Error Catalog (Phase 3 additions — optional)
- No new error codes are strictly required; reuse:
  - PATH_DENIED, NO_ACTIVE_WORKSPACE, VALIDATION_ERROR, FILE_NOT_FOUND, DB_OPERATION_FAILED, INTERNAL_ERROR
- If we later restrict export to outside-workspace destinations (opt-in), we can add EXPORT_PATH_DENIED; deferred.

Implementation Plan
A) SelectionService (new)
- Create [src/main/selection-service.ts](src/main/selection-service.ts)
- Responsibilities:
  - normalizeRanges(ranges): merge/sort/clamp; enforce start <= end; dedupe; coalesce contiguous ranges.
  - mergeSelect(existing, next): returns updated selection entry.
  - subtractRanges(existing, toRemove): returns updated ranges or empty.
  - applySelect(state, items): returns new WorkspaceState with sanitized absolute paths from [validateAndResolvePath()](src/main/file-service.ts:49) persisted.
  - applyDeselect(state, items): returns new WorkspaceState.
  - persist shape discipline: store only { path, lines? } per entry; never persist content/tokenCount fields even though DB WorkspaceState type allows them.
- Internals:
  - Use pure functions; no fs inside this service.
- Rationale: keep API handlers slim and test these transformations in isolation.

B) API Server Extensions
- In [src/main/api-server.ts](src/main/api-server.ts:142):
  - Add routes:
    - POST /api/v1/files/select
    - POST /api/v1/files/deselect
    - POST /api/v1/files/clear
    - GET /api/v1/files/selected
    - GET /api/v1/content
    - POST /api/v1/content/export
  - Validation:
    - active workspace via DB preference 'workspace.active'
    - resolve workspace via [DatabaseBridge.getWorkspace](src/main/db/database-bridge.ts:138); sync allowedPaths if missing
  - Path checks per-item via [validateAndResolvePath()](src/main/file-service.ts:49)
  - DB writes via [updateWorkspaceById](src/main/db/database-bridge.ts:162)

C) Content Aggregation Helper (new)
- Create [src/main/content-aggregation.ts](src/main/content-aggregation.ts)
- Responsibilities:
  - buildAllFiles(folderPath, selection, fileTreeMode, exclusionPatterns?): Promise<FileData[]>
    - For "selected"/"selected-with-roots": return selected files plus ancestor directories only.
    - For "complete": scan entire workspace with ignore rules from [loadGitignore()](src/utils/ignore-utils.ts:13) and binary skips from [isBinaryExtension()](src/file-ops/filters.ts:31).
  - readSelectedFilesContent(files: FileData[], selection): Promise<void>
    - Load UTF-8 content for selected files using [readTextFile()](src/main/file-service.ts:127), setting isContentLoaded and content.
  - assembleContent(workspace): returns { content, fileCount }
- Internals:
  - Implement a Node fs-based walker (non-blocking batches using setImmediate) instead of reusing renderer workers.
  - Use [getSelectedFilesContent()](src/utils/content-formatter.ts:275) for formatting.
- Rationale: keeps API entry points simple; test separately.

D) Export Writer (new)
- Create [src/main/export-writer.ts](src/main/export-writer.ts)
- Responsibilities:
  - writeExport(absoluteOutputPath, content, overwrite): Promise<{ bytes: number }>
- Safety:
  - Ensure parent directory exists; deny if not under allowedPaths.

E) No In-Memory Fallbacks
- Maintain fail-fast policy; DB must be present (Phase 1 invariant).

Request/Response Schemas (Canonical)
- Files select (body):
  - const lineRange = z.object({ start: z.number().int().min(1), end: z.number().int().min(1) });
  - const selectionItem = z.object({ path: z.string().min(1), lines: z.array(lineRange).nonempty().optional() });
  - const selectBody = z.object({ items: z.array(selectionItem).min(1) });
- Files deselect (body): same as selectBody
- Files clear (body): z.object({}).optional()
- Files selected (response): { data: selectionItem[] }
- Content export (body): z.object({ outputPath: z.string().min(1), overwrite: z.boolean().optional() })

Pseudocode (Key Endpoints)
POST /api/v1/files/select
- Validate body
- Ensure active workspace
- For each item: validateAndResolvePath(item.path); fs.stat() → if ENOENT, 404
- Load workspace by id
- nextState = applySelect(workspace.state, items)
- updateWorkspaceById(id, nextState)
- return ok(true)

POST /api/v1/files/deselect
- Validate body
- Ensure active workspace
- For each item: validateAndResolvePath(item.path)
- nextState = applyDeselect(workspace.state, items)
- updateWorkspaceById(id, nextState)
- return ok(true)

POST /api/v1/files/clear
- Ensure active workspace
- updateWorkspaceById(id, { ...state, selectedFiles: [] })
- return ok(true)

GET /api/v1/files/selected
- Ensure active workspace
- return ok(workspace.state.selectedFiles ?? [])

GET /api/v1/content
- Ensure active workspace
- selection0 = state.selectedFiles || []
- selection1 = for each item in selection0: validate via [validateAndResolvePath()](src/main/file-service.ts:49); drop entries with PATH_DENIED or FILE_NOT_FOUND (pruned)
- allFiles = await buildAllFiles(workspace.folderPath, selection1, state.fileTreeMode, state.exclusionPatterns)
- await readSelectedFilesContent(allFiles, selection1)
- content = getSelectedFilesContent(allFiles, selection1, state.sortOrder, state.fileTreeMode, state.selectedFolder, state.systemPrompts ?? [], state.rolePrompts ?? [], state.selectedInstructions ?? [], state.userInstructions ?? '')
- tokenCount = (await getMainTokenService().countTokens(content)).count
- return ok({ content, fileCount: selection1.length, tokenCount })

POST /api/v1/content/export
- Validate body
- Ensure active workspace
- Resolve outputPath via validateAndResolvePath; require output under workspace
- Generate content as in GET /content
- If exists && !overwrite → 400 VALIDATION_ERROR
- Write file; return ok({ outputPath, bytes })

Testing Plan (Comprehensive)
Unit tests
- SelectionService:
  - normalizeRanges: clamps, sorts, merges
  - mergeSelect behaviors (whole-file vs lines)
  - subtractRanges behaviors and edge conditions
- Content aggregation helper:
  - assembleContent returns stable shapes and counts
- Export writer:
  - overwrite behavior, path denial outside workspace
Integration tests (server)
- Auth:
  - Valid token accepted; invalid rejected
- Selection:
  - select single file, select ranges, upgrade to whole file
  - deselect ranges to zero, remove file
  - clear selection
- Content:
  - returns aggregated content and tokenCount
  - denies when no active workspace
- Export:
  - writes file under workspace
  - denies outside workspace
Performance/Regression
- Aggregation for N files remains within time/memory budgets
- No regressions to Phase 1/2 invariants

Performance and Memory Considerations
- Avoid caching at API layer; allFiles built per request (Option A).
- Large selections: consider soft cap; return VALIDATION_ERROR if content exceeds safe length (enforceable via length checks before token counting).
- Batch fs operations and yield to event loop for big folders.

Risks and Mitigations
- Path traversal attempts:
  - validateAndResolvePath for every path; re-check during aggregation.
- Selection drift via manual DB edits:
  - API always re-validates paths and prunes invalid entries during aggregation.
- Huge exports:
  - Enforce length caps; document CLI behavior to paginate if needed.

Day-by-Day Implementation Checklist
Day 1
- Add SelectionService with full unit tests
- Add Export writer and content aggregation helper (minimal version)
- Extend error handling utilities if needed (no new codes expected)
Day 2
- Implement /files/select, /files/deselect, /files/clear, /files/selected routes with Zod
- Implement /content and /content/export routes
- Add integration tests (main-process only)
Day 3
- Smoke test end-to-end using ephemeral port, token auth, and a temp workspace
- Documentation updates and CLI usage examples

CLI Guidance (to be implemented in CLI repo)
- Selection
  - pasteflow files select --path /abs/file.ts --lines 10-20,30-40
  - pasteflow files deselect --path /abs/file.ts --lines 15-18
  - pasteflow files clear
  - pasteflow files selected
- Aggregation and export
  - pasteflow content
  - pasteflow content export --output ./pasteflow-output.txt --overwrite

Completion Criteria (Phase 3)
- All selection and aggregation endpoints implemented with Zod validation and error normalization
- Selection operations scoped to allowedPaths and persisted in WorkspaceState
- Content aggregation functional without persisting allFiles
- Export writes only within workspace and honors overwrite semantics
- Test suite covers happy paths and common failures; no regressions to Phase 1/2

Appendix: Key Cross-References
- API server base: [src/main/api-server.ts](src/main/api-server.ts:1)
- Error helpers: [ok()](src/main/error-normalizer.ts:25), [toApiError()](src/main/error-normalizer.ts:21)
- Path validation: [PathValidator](src/security/path-validator.ts:9), [getPathValidator()](src/security/path-validator.ts:108)
- File ops helpers: [validateAndResolvePath()](src/main/file-service.ts:49)
- DB bridge methods: [getWorkspace()](src/main/db/database-bridge.ts:138), [updateWorkspaceById()](src/main/db/database-bridge.ts:162)
- Aggregation utilities: [getSelectedFilesContent()](src/utils/content-formatter.ts:275)