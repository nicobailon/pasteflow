# Phase 2 — Content Operations Plan
This document defines the Phase 2 implementation plan for Content Operations (single-file content and token counting), with exhaustive cross-references to the existing codebase and concrete, regression-safe specifications. It corrects inaccuracies found in earlier drafts and integrates tightly with the Phase 1 infrastructure now in place.

Scope and Goals (Phase 2)
- Primary goals
  - Add HTTP endpoints for:
    - GET /api/v1/files/content?path=...  (single file text content + tokenCount)
    - GET /api/v1/files/info?path=...     (file metadata without content)
    - POST /api/v1/tokens/count           ({ text } → { count, backend })
    - GET /api/v1/tokens/backend          ({ backend })
    - GET /api/v1/folders/current         ({ folderPath } of active workspace, or null)
    - POST /api/v1/folders/open           ({ folderPath, name? } → create+activate workspace)
  - Guarantee path safety with the PathValidator, honoring the allow-first model and allowedPaths derived from active workspace selection.
  - Return consistent error payloads (JSON) with code catalog parity across API/IPC.
  - Use the TokenService directly to return { count, backend }, never just the number.
- Non-goals
  - Multi-file aggregation, selection mutations, and preview packs (moved to Phase 3+).
  - Any re-introduction of legacy or in-memory fallbacks.
  - Changing renderer-side VirtualFileLoader semantics (only inform API behavior).

Baseline: Verified Code and Architecture
- HTTP server (Express) in main process with auth-first flow:
  - See [src/main/api-server.ts](src/main/api-server.ts:47) for constructor and middleware sequence:
    - Auth middleware precedes JSON parsing for efficiency.
    - JSON parse errors normalized to 400 VALIDATION_ERROR.
- Status & workspaces:
  - /status endpoint derives active workspace from preference and falls back to DB folder_path for allowedPaths if context empty: [src/main/api-server.ts](src/main/api-server.ts:136)
  - Workspace CRUD endpoints implemented with Zod validation and snake_case→camelCase mapping: [src/main/api-server.ts](src/main/api-server.ts:158)
- Preferences API implemented with Zod param/body validation: [src/main/api-server.ts](src/main/api-server.ts:298)
- Token service
  - Service entry point: [getMainTokenService()](src/services/token-service-main.ts:109)
  - Contract for counting with backend label: [TokenService.countTokens()](src/services/token-service.ts:48)
  - Detect active backend: [TokenService.getActiveBackend()](src/services/token-service.ts:169)
- IPC file content precedent (will influence Phase 2 API behavior)
  - Validation flow and token counting for single-file content already exist via IPC: [ipcMain.handle('request-file-content')](src/main/main.ts:609)
  - Binary detection and file-size protections:
    - Main helpers: isSpecialFile(), isBinaryFile(), content limit via constants: [src/main/main.ts](src/main/main.ts:50)
    - Global constants: [FILE_PROCESSING.MAX_FILE_SIZE_BYTES](src/constants/app-constants.ts:10)
    - Binary-content heuristics (used elsewhere and renderer utilities): [src/file-ops/filters.ts](src/file-ops/filters.ts:38)

Corrections (Fresh-Eyes) vs. Earlier Drafts
- Error Catalog Gaps
  - To fully support Phase 2, extend error codes with:
    - BINARY_FILE (for attempts to read binary/special files as text)
    - NO_ACTIVE_WORKSPACE (when file ops require an active workspace but none exists)
  - Update catalog in [src/main/error-normalizer.ts](src/main/error-normalizer.ts:1) to include both codes and ensure mapping in APIs.
- Content endpoints must never return binary bytes
  - Return a 400 VALIDATION_ERROR or a dedicated BINARY_FILE error for non-text assets to avoid memory pressure and UX regressions.
- Active workspace requirement for file operations
  - Single-file operations must be scoped to allowedPaths of the active workspace. If unset, respond with NO_ACTIVE_WORKSPACE.
- Token service integration must return shape { count, backend }
  - Do not mirror the older “number-only” count used within some IPC contexts; Phase 2 HTTP routes must expose the full { count, backend } structure via [TokenService.countTokens()](src/services/token-service.ts:48).

API Additions (Phase 2)
1) GET /api/v1/files/content
- Query:
  - path: string (required; absolute or project path)
- Response:
  - 200: { data: { content: string; tokenCount: number; fileType: string } }
  - 400: { error: { code: 'VALIDATION_ERROR', message: ... } } on invalid query
  - 401: UNAUTHORIZED (existing middleware)
  - 403: { error: { code: 'PATH_DENIED', ... } } if outside allowedPaths
  - 404: { error: { code: 'FILE_NOT_FOUND', ... } }
  - 409: { error: { code: 'BINARY_FILE', message: 'File contains binary data' } }
  - 500: { error: { code: 'DB_OPERATION_FAILED', ... } } (unexpected DB errors)
- Behavior:
  - Require an active workspace. If none: 400 { code: 'NO_ACTIVE_WORKSPACE' }.
  - Validate path via PathValidator:
    - Allow immediately if within allowedPaths (allow-first).
    - Deny if blocked paths matched or outside workspace when allowedPaths is non-empty.
  - Reject if file exceeds [FILE_PROCESSING.MAX_FILE_SIZE_BYTES](src/constants/app-constants.ts:10).
  - Reject binaries/special files (same logic as IPC):
    - See [ipcMain.handle('request-file-content')](src/main/main.ts:609), [isSpecialFile()](src/main/main.ts:50), and [isBinaryFile()](src/main/main.ts:55).
    - If reading text “looks binary” by heuristic, reject as BINARY_FILE: [isLikelyBinaryContent()](src/file-ops/filters.ts:48).
  - Token count must be computed via [getMainTokenService()](src/services/token-service-main.ts:109) and [TokenService.countTokens()](src/services/token-service.ts:48) and returned alongside content.
  - fileType language mapping may reuse logic consistent with [getFileType()](src/utils/content-formatter.ts:328) or the extension-to-language mapping in the same module.

2) GET /api/v1/files/info
- Query:
  - path: string (required)
- Response:
  - 200: { data: { path: string; name: string; size: number; mtimeMs: number; isDirectory: boolean; isBinary: boolean; fileType: string | null } }
  - Same error handling as /files/content, but does not read file content (no tokenCount).
- Behavior:
  - Active workspace required; same PathValidator rules as above.
  - Stats via fs.stat; detect binary by extension and special files:
    - Use [BINARY_EXTENSIONS](src/file-ops/filters.ts:10) and main special extensions logic currently in [src/main/main.ts](src/main/main.ts:37) (consider factoring into a shared utility to avoid duplication).
  - fileType is best-effort language alias or null.

3) POST /api/v1/tokens/count
- Body: { text: string }
- Response:
  - 200: { data: { count: number; backend: 'worker-pool' | 'tiktoken' | 'estimate' } }
  - 400: VALIDATION_ERROR if text missing or too large
- Behavior:
  - Use [TokenService.countTokens()](src/services/token-service.ts:48); respect [TokenServiceConfig.maxTextSize](src/services/token-service.ts:10) (trigger 'estimate' fallback on large text, see byte-size logic at [src/services/token-service.ts](src/services/token-service.ts:54)).

4) GET /api/v1/tokens/backend
- Response:
  - 200: { data: { backend: 'worker-pool' | 'tiktoken' | 'estimate' } }
- Behavior:
  - Use [TokenService.getActiveBackend()](src/services/token-service.ts:169); if null and estimate fallback is enabled, return 'estimate'.

5) GET /api/v1/folders/current
- Response:
  - 200: { data: { folderPath: string } | null }
- Behavior:
  - Read preference 'workspace.active' via [DatabaseBridge.getPreference](src/main/api-server.ts:302).
  - If set, resolve workspace and return its folder_path (camelCase folderPath).
  - If not set, return null.

6) POST /api/v1/folders/open
- Body:
  - { folderPath: string; name?: string }
- Response:
  - 200: { data: { id: string; name: string; folderPath: string } }
  - 400: VALIDATION_ERROR if path invalid or outside safe roots (if configured)
  - 409: if a different workspace exists with the same name (name collisions)
- Behavior:
  - If a workspace already exists at folderPath, reuse it; otherwise create a new workspace via [DatabaseBridge.createWorkspace](src/main/api-server.ts:173).
  - Set preference 'workspace.active' and call [setAllowedWorkspacePaths()](src/main/api-server.ts:237) with the workspace folder_path to sync PathValidator context.

Security and Validation
- Authorization: existing bearer token flow remains mandatory (no change).
- Zod validation:
  - For files/content and files/info: query schema: z.object({ path: z.string().min(1) })
  - For tokens/count: body schema: z.object({ text: z.string().min(0).max(MAX_TEXT_SIZE_BYTES_IN_CHARS_APPROX) })
  - For folders/open: z.object({ folderPath: z.string().min(1), name: z.string().min(1).max(VALIDATION.MAX_WORKSPACE_NAME_LENGTH).optional() })
- PathValidator:
  - Continue allow-first and normalized Windows paths setup (already implemented): [src/security/path-validator.ts](src/security/path-validator.ts:29)
  - For files outside allowedPaths when allowedPaths exist: return PATH_DENIED (403)
  - No active workspace: return NO_ACTIVE_WORKSPACE (400)
- Binary/Special files:
  - Maintain shared rules:
    - Extension/heuristic check: [src/file-ops/filters.ts](src/file-ops/filters.ts:10), [src/file-ops/filters.ts](src/file-ops/filters.ts:48)
    - Main special file set: [src/main/main.ts](src/main/main.ts:37) (consider extracting to a shared module to eliminate duplication between IPC and API)
- Size limits:
  - Enforce [FILE_PROCESSING.MAX_FILE_SIZE_BYTES](src/constants/app-constants.ts:10) for file reads.

Error Catalog (additions for Phase 2)
- Extend [ApiErrorCode](src/main/error-normalizer.ts:1) with:
  - BINARY_FILE: when a content request targets a binary or special file
  - NO_ACTIVE_WORKSPACE: when an operation requires an active workspace but none is selected
- Ensure these codes are used consistently across:
  - /files/content and /files/info
  - tokens endpoints (VALIDATION_ERROR for body issues)
  - folders endpoints (WORKSPACE_NOT_FOUND on resolution issues; VALIDATION_ERROR on name/path issues)

Implementation Plan
A) Shared File Service (new)
- Create src/main/file-service.ts (or src/main/services/file-service.ts) to avoid duplicating logic between IPC and API.
- Responsibilities:
  - validateAndResolvePath(path: string): { ok: true, absolutePath: string } | { ok: false, code: ApiErrorCode, message: string }
    - Uses PathValidator and allowedPaths
  - statFile(absolutePath): { name, path, size, isDirectory, isBinary, mtimeMs, fileType }
  - readTextFile(absolutePath): { content, isLikelyBinary }
    - Enforce size caps and heuristic checks
- Internals:
  - Import constants from [src/constants/app-constants.ts](src/constants/app-constants.ts:1)
  - Reuse extension sets from [src/file-ops/filters.ts](src/file-ops/filters.ts:10)
  - Factor “special extensions” currently in [src/main/main.ts](src/main/main.ts:37) into a small shared list to eliminate main.ts duplication.

B) API Server Extensions
- In [src/main/api-server.ts](src/main/api-server.ts:131):
  - Add:
    - GET /api/v1/files/content (query zod; calls FileService; returns { content, tokenCount, fileType })
    - GET /api/v1/files/info (query zod; calls FileService; returns metadata)
    - POST /api/v1/tokens/count (body zod; uses [getMainTokenService()](src/services/token-service-main.ts:109))
    - GET /api/v1/tokens/backend (uses [TokenService.getActiveBackend()](src/services/token-service.ts:169))
    - GET /api/v1/folders/current (reads active workspace preference, resolves folder_path)
    - POST /api/v1/folders/open (zod validate; idempotently create or reuse; set active; setAllowedWorkspacePaths)
- Error normalization:
  - Reuse [ok()](src/main/error-normalizer.ts:23) and [toApiError()](src/main/error-normalizer.ts:19)
  - Map file/binary conditions to codes as specified above.

C) Error Normalizer Updates
- Extend ApiErrorCode in [src/main/error-normalizer.ts](src/main/error-normalizer.ts:1) with BINARY_FILE and NO_ACTIVE_WORKSPACE.
- No stack traces in error JSON (preserve plan discipline).

D) No In-Memory Fallbacks
- Maintain Phase 1 fail-fast policy:
  - DB must be initialized; otherwise app exits (already implemented): [src/main/main.ts](src/main/main.ts:231)
  - API endpoints must not provide fallback content if DB or preferences unavailable.

E) Port and Auth
- No changes; continue to write bound port (including dynamic binding): [src/main/main.ts](src/main/main.ts:250)
- Token file semantics remain unchanged.

Request/Response Schemas (Canonical)
Zod samples (express-style)
- Files content (query):
  - const filePathQuery = z.object({ path: z.string().min(1) });
- Files info (query):
  - const fileInfoQuery = z.object({ path: z.string().min(1) });
- Tokens count (body):
  - const tokensCountBody = z.object({ text: z.string().min(0) });
- Folders open (body):
  - const foldersOpenBody = z.object({ folderPath: z.string().min(1), name: z.string().min(1).max(255).optional() });

Shapes returned
- Success is always wrapped via ok():
  - { data: ... }
- Errors are always:
  - { error: { code: ApiErrorCode, message: string, details?: object } }

Pseudocode (Key Endpoints)
GET /api/v1/files/content
- Validate query
- Ensure active workspace; else 400 NO_ACTIVE_WORKSPACE
- Validate path via FileService.validateAndResolvePath()
- Stat file; if binary/special or too large → 409 BINARY_FILE or 400 VALIDATION_ERROR (size)
- Read content; if isLikelyBinary → 409 BINARY_FILE
- Count tokens with [TokenService.countTokens()](src/services/token-service.ts:48); return { content, tokenCount, fileType }

POST /api/v1/tokens/count
- Validate body
- Return await getMainTokenService().countTokens(text) (value’s shape is { count, backend })

GET /api/v1/folders/current
- Read 'workspace.active'; if present, resolve workspace and return its folderPath; else null

POST /api/v1/folders/open
- Validate body
- name default could be derived from folder basename if omitted
- Reuse existing workspace if folderPath matches; else create workspace
- Set 'workspace.active', update allowedPaths

Testing Plan (Comprehensive)
Unit tests
- FileService:
  - validateAndResolvePath:
    - Accepts path inside workspace allowedPaths
    - Denies outside workspace with PATH_DENIED
    - Returns NO_ACTIVE_WORKSPACE if allowedPaths empty and active unset
  - statFile/readTextFile:
    - Honors FILE_PROCESSING.MAX_FILE_SIZE_BYTES
    - Identifies binary/special files correctly
- TokenService:
  - countTokens returns { count, backend } where backend is 'tiktoken' if available else 'estimate' (deterministic stubbing)
  - getActiveBackend resilient to failure returning fallback
Integration tests (server)
- Auth:
  - Valid token passes; invalid/missing rejected
- Files content/info:
  - Path inside workspace returns 200 with proper shapes
  - Binary file returns BINARY_FILE
  - Oversized file returns VALIDATION_ERROR size violation
- Tokens:
  - count returns shape with correct backend
  - backend returns active backend
- Folders:
  - current returns folderPath when active set, null otherwise
  - open creates workspace and sets it active; allowedPaths reflect new folder
E2E smoke
- Spin up Electron with API; call folders open; then files info; then files content; finally tokens endpoints
- Verify port file and auth token present with correct perms

Performance and Memory Considerations
- Do not stream file content in Phase 2; read-as-text once with size cap.
- Avoid caching at API layer; rely on renderer caches (e.g., VirtualFileLoader) and do not cross-couple.
- TokenService enforces maxTextSize via byte-size check: see [src/services/token-service.ts](src/services/token-service.ts:54)

Risks and Mitigations
- Large binary/text confusion
  - Dual-check: extension list + content heuristic; return BINARY_FILE if suspicious
- Path traversal
  - Normalization and allow-first; reject malicious paths (.., NUL, etc.) already enforced by PathValidator: [src/security/path-validator.ts](src/security/path-validator.ts:35)
- Race on workspace activation vs content read
  - /folders/open sets active before returning; content endpoints will check allowedPaths on each request

Implementation Checklist (Day-by-Day)
Day 1
- Add FileService (validate/stat/read; extracted special/binary/shared logic)
- Extend error-normalizer with BINARY_FILE, NO_ACTIVE_WORKSPACE
- Implement GET /files/info and GET /files/content routes with Zod and normalization
Day 2
- Implement tokens endpoints (POST /tokens/count, GET /tokens/backend)
- Implement folders endpoints (GET /folders/current, POST /folders/open)
- Update API tests for new routes (unit + integration)
Day 3
- Smoke tests with real app; verify port/auth/token paths and permissions; verify workspace selection interplay
- Documentation updates and CLI usage examples

CLI Guidance (to be implemented in CLI repo)
- Read auth token from ~/.pasteflow/auth.token and port from ~/.pasteflow/server.port
- Example operations:
  - pasteflow files info --path /abs/path/to/file.ts
  - pasteflow files content --path /abs/path/to/file.ts
  - pasteflow tokens count --stdin < mytext.txt
  - pasteflow folders current
  - pasteflow folders open --path /abs/path/to/project --name my-project

Completion Criteria (Phase 2)
- All new endpoints implemented with Zod validation and error normalization
- File operations strictly scoped to allowedPaths of active workspace
- Token endpoints use TokenService and return backend
- Test suite covers happy paths and common failures (auth, validation, path safety, binary detection, size caps)
- No regressions to Phase 1 invariants (auth-first, error payload shapes, fail-fast DB, path validator policy)

Appendix: Key Cross-References
- API server base: [src/main/api-server.ts](src/main/api-server.ts:1)
- Active workspace status building: [src/main/api-server.ts](src/main/api-server.ts:136)
- Preferences API: [src/main/api-server.ts](src/main/api-server.ts:298)
- IPC file content for precedent: [src/main/main.ts](src/main/main.ts:609)
- File filters and binary heuristics: [src/file-ops/filters.ts](src/file-ops/filters.ts:1)
- Path normalization and validation: [src/file-ops/path.ts](src/file-ops/path.ts:99), [src/security/path-validator.ts](src/security/path-validator.ts:29)
- Token service:
  - [TokenService.countTokens()](src/services/token-service.ts:48)
  - [TokenService.getActiveBackend()](src/services/token-service.ts:169)
  - [getMainTokenService()](src/services/token-service-main.ts:109)