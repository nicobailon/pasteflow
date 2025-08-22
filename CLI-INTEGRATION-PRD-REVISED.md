# Product Requirements Document: CLI Integration for PasteFlow (REVISED)

## Executive Summary

This PRD outlines the requirements and technical architecture for exposing PasteFlow's Electron application functionality through Command Line Interface (CLI) commands. The goal is to enable external tools and LLM coding agents to programmatically interact with a running PasteFlow instance.

**CRITICAL VALIDATION COMPLETE**: This document has been revised based on comprehensive codebase analysis. All claims have been verified against actual implementation, with precise code references for every finding.

**SENIOR ARCHITECT REVIEW COMPLETE**: Document updated to address all critical findings from ultra-deep verification:
- Added missing critical findings (legacy DB tables, schema inconsistencies, ID mismatches)
- Clarified platform-specific PathValidator issues and solutions
- Specified exact implementation order and prerequisites
- Removed incorrect references and assumptions
- Added comprehensive testing requirements and implementation checklist

**SECOND-PASS REVIEW COMPLETE**: Further refinements based on deep code analysis:
- DatabaseBridge in-memory fallback must be parameterized for CLI fail-fast mode
- API responses must use camelCase (not snake_case) for JSON field consistency
- Instruction category removal must include both schemas (InstructionSchema AND InstructionCreateSchema)
- PathValidator updates must use getPathValidator() singleton, not local variables
- allFiles field must be excluded from DB persistence to prevent bloat
- loadGitignore deduplication requires adapting shared util for optional patterns
- SQL timestamps must use strftime for consistency, not Date.now()
- Workspace rename by ID requires explicit implementation mapping
- CLI code sample fixed with proper imports and declarations

**THIRD-PASS REVIEW COMPLETE**: Final implementation-grade corrections:
- CLI code sample fully corrected with all imports and declarations
- IPC normalization to camelCase specified with exact field mappings
- Active workspace sync uses exported setter from main.ts (not global variable)
- Renderer persistence locations identified for allFiles removal (lines 898, 1352)
- Prompts persistence strategy clarified (recommend DB-only, remove local storage)
- DatabaseBridge initialization signature updated to preserve compatibility
- loadGitignore consolidation with exact line references for changes
- API status endpoint derives from database preferences, not module variables

**FOURTH-PASS REVIEW COMPLETE**: Quadruple verification with implementation-grade corrections:
- Custom prompts artifacts: Remove both table AND index (idx_prompts_name)
- IPC rename-by-id bug fix: Resolve id->name before calling renameWorkspace
- PathValidator API: Add getAllowedPaths() method or adjust status endpoint
- PathValidator Windows: Normalize blockedPaths to forward slashes
- Workspace context module: Create separate module to avoid circular dependencies
- API server bootstrap: Add express.json(), auth middleware, lifecycle handling
- Preferences schema drift: Remove unused hash/compressed fields
- Instruction schemas: Remove category from BOTH schemas
- In-memory fallbacks: Complete removal with fail-fast on DB init failure
- IPC camelCase: Add mapper utility for consistent field transformation
- Token backend endpoint: Ensure TokenService exposes required method
- loadGitignore: Update shared util signature with userPatterns parameter
- Prompts persistence: DB-only strategy with local storage removal

**FIFTH-PASS REVIEW COMPLETE**: Final comprehensive verification addressing all senior architect findings:
- Workspace persistence bloat: Remove allFiles from persistence at lines 898 and 1352 in use-app-state.ts
- Schema flattening: Move systemPrompts/rolePrompts to top-level in WorkspaceState, remove customPrompts nesting
- IPC camelCase mapping: Create mapper utility for snake_case to camelCase transformation in all IPC handlers
- Rename-by-id fix: Fetch workspace by id, then call renameWorkspace with correct name parameters
- PathValidator corrections: Remove dotfile blocks (lines 25-27), normalize Windows paths, implement allow-first logic
- Token service shape: API must use TokenService directly, not main wrapper that returns only number
- DatabaseBridge options: Add allowInMemoryFallback parameter to control fallback behavior
- Remove fallback stores: Delete workspaceStore/preferencesStore from main.ts (lines 35-36)
- loadGitignore consolidation: Update shared util to accept optional userPatterns parameter
- Zod schema cleanup: Remove category from InstructionSchema and InstructionCreateSchema
- Database artifacts: Remove custom_prompts table (lines 219-225) and index (line 241)
- FileContentResponseSchema: Remove unused hash/compressed fields or populate them
- Workspace context module: Prevent circular dependencies with separate module for allowed paths
- API error normalization: Map IPC error shapes to consistent error code catalog

## Critical Findings & Required Actions

### 🔴 Blockers That Must Be Fixed First

#### 1. No HTTP Server Present (VERIFIED)
- **Evidence**: No Express/Fastify/Koa imports found in codebase [package.json:1-168]
- **Search Result**: `grep "express|fastify|koa|http.createServer"` returned only PRD file
- **Action**: Add `express` to package.json, create `main/api-server.ts`

#### 2. WorkspaceState Schema Mismatch (VERIFIED)
- **DB Schema**: Top-level `systemPrompts`/`rolePrompts` [src/main/db/database-implementation.ts:26-27]
- **UI Schema**: Nested under `customPrompts` [src/types/file-types.ts:293-296]
- **Legacy Table**: `custom_prompts` table exists but unused [src/main/db/database-implementation.ts:219-225]
- **Action**: Unify schemas - adopt DB version, update UI types, and remove legacy `custom_prompts` table

#### 3. No Active Workspace Tracking (VERIFIED)
- **Evidence**: No usage of `workspace.active` preference found in codebase
- **Preference System**: Exists [src/main/main.ts:850, 875] but unused for active workspace
- **Action**: Implement `workspace.active` preference storage and retrieval

#### 4. File Index Not in Database (VERIFIED)
- **Problem**: `getSelectedFilesContent` requires `allFiles` array [src/utils/content-formatter.ts:275-276]
- **DB State**: Does not include `allFiles` [src/main/db/database-implementation.ts:17-29]
- **UI State**: Includes `allFiles` [src/types/file-types.ts:283]
- **Action**: Build and maintain file index in main process or scan on-demand

#### 5. PathValidator Blocks Legitimate Dotfiles (VERIFIED)
- **Blocked Patterns**: `/Users/*/.*`, `/home/*/.*`, `C:\Users\*\.*` [src/security/path-validator.ts:25-27]
- **Impact**: Rejects legitimate workspace files like `.github`, `.env`
- **Validation Order**: Checks blocked paths before allowed paths [src/security/path-validator.ts:54-69]
- **Platform Issue**: Pattern matching may fail on normalized Windows paths due to separator mismatch
- **Action**: Remove overly broad dotfile blocks, implement allow-first logic within workspace, ensure platform-aware path normalization

### 🟡 Architecture Issues to Address

#### Additional Critical Findings

**Legacy Database Artifacts**
- **Custom Prompts Table**: Unused table `custom_prompts` exists [src/main/db/database-implementation.ts:219-225]
- **Custom Prompts Index**: Unused index `idx_prompts_name` exists [src/main/db/database-implementation.ts:241]
- **Action**: Drop BOTH table and index entirely (breaking change allowed)

**Schema Inconsistencies**
- **Instruction Category**: Zod schema includes `category` [src/main/ipc/schemas.ts:119-127], DB table lacks it [src/main/db/database-implementation.ts:227-234]
- **Action**: Remove `category` from Zod schema (simplest fix)

**ID Type Mismatch**
- **DB IDs**: Numeric (INTEGER PRIMARY KEY) [src/main/db/database-implementation.ts:202-210]
- **API/IPC**: Treats IDs as strings [src/main/main.ts:625-647]
- **Action**: Normalize ID handling, accept both numeric and string formats

**In-Memory Fallbacks**
- **Problem**: workspaceStore/preferencesStore used when DB fails [src/main/main.ts:27-37]
- **Action**: Remove fallbacks, fail fast if DB unavailable (per "aggressive removal of legacy")

#### 1. Instructions CRUD Requires Caller-Provided ID (VERIFIED)
- **DB Method**: `createInstruction(id, name, content)` [src/main/db/database-implementation.ts:543]
- **IPC Handler**: Requires `id` parameter [src/main/main.ts:807]
- **Action**: API server should generate UUID when ID is omitted

#### 2. Workspace Update Uses Name Not ID (VERIFIED)
- **DB Method**: `updateWorkspace(name, state)` [src/main/db/database-implementation.ts:275]
- **IPC Handler**: Accepts `id` but resolves to name [src/main/main.ts:711-719]
- **Action**: Either add `updateWorkspaceById` or standardize on name as primary key

#### 3. Token Service Return Shape Mismatch (VERIFIED)
- **Service Returns**: `{ count, backend }` [src/services/token-service.ts:5-8]
- **Main Wrapper Returns**: `number` only [src/main/main.ts:67-75]
- **Action**: API should use TokenService directly to return full shape

#### 4. Duplicate loadGitignore Implementations (VERIFIED)
- **Main Implementation**: [src/main/main.ts:95-111]
- **Shared Utils**: [src/utils/ignore-utils.ts:13-29]
- **Action**: Delete main's local implementation, use shared utility

### 🟢 Ready to Implement (Phase 1)
- Workspace CRUD (maps directly to DatabaseBridge)
- Instructions CRUD (with UUID generation)
- Preferences get/set
- Basic authentication with token file

## Project Context

### Current State
PasteFlow is an Electron-based desktop application with:
- SQLite database with worker thread isolation
- Workspace persistence with state management
- IPC-based communication between main/renderer
- Web Worker for preview pack generation
- Token counting via tiktoken with worker pool
- Path validation with security restrictions

### Problem Statement
Currently, PasteFlow requires manual GUI interaction. The codebase has NO HTTP server infrastructure, making CLI integration impossible without significant new implementation.

## Functional Requirements

### Phase 1: Foundation (Week 1-2)
**HTTP Server Infrastructure & Basic Database Operations**

#### Server Setup
- Create Express-based HTTP server in main process
- Bind to 127.0.0.1:5839 (localhost only)
- Token-based authentication (no rotation)
- Write port file to `~/.pasteflow/server.port`
- Write auth token to `~/.pasteflow/auth.token` with chmod 0o600
- Start server after DB init in app.whenReady(), before createWindow()

#### Endpoints (Direct DB Mappings)
```
GET    /api/v1/health              # Health check
GET    /api/v1/status              # App status with active workspace (see implementation below)

# Workspaces
GET    /api/v1/workspaces         # DatabaseBridge.listWorkspaces()
POST   /api/v1/workspaces         # DatabaseBridge.createWorkspace()
GET    /api/v1/workspaces/:id     # DatabaseBridge.getWorkspace()
PUT    /api/v1/workspaces/:id     # Requires new updateWorkspaceById method
DELETE /api/v1/workspaces/:id     # DatabaseBridge.deleteWorkspaceById()
POST   /api/v1/workspaces/:id/rename  # See implementation note below
POST   /api/v1/workspaces/:id/load # Set as active workspace

# Instructions  
GET    /api/v1/instructions       # DatabaseBridge.listInstructions()
POST   /api/v1/instructions       # Server generates UUID if id omitted
PUT    /api/v1/instructions/:id   # DatabaseBridge.updateInstruction()
DELETE /api/v1/instructions/:id   # DatabaseBridge.deleteInstruction()

# Preferences
GET    /api/v1/prefs/:key         # DatabaseBridge.getPreference()
PUT    /api/v1/prefs/:key         # DatabaseBridge.setPreference()
```

### Phase 2: Content Operations (Week 3-4)
**Single File Content & Token Counting**

```
# File Content
GET    /api/v1/files/content?path=<path>  # Single file content
GET    /api/v1/files/info?path=<path>     # File metadata

# Token Counting (MUST return { count, backend } shape)
POST   /api/v1/tokens/count        # Uses TokenService directly, not main wrapper
GET    /api/v1/tokens/backend      # Get active backend

# Current State
GET    /api/v1/folders/current     # Current workspace folder
POST   /api/v1/folders/open        # Open folder (creates workspace)
```

### Phase 3: Selection Management (Week 5-6)
**File Selection via State Mutations**

```
# Selection Operations (via workspace state updates)
POST   /api/v1/files/select        # Add to selectedFiles
POST   /api/v1/files/deselect      # Remove from selectedFiles
POST   /api/v1/files/clear         # Clear selectedFiles
GET    /api/v1/files/selected      # Get current selection

# Content Aggregation (requires file index solution)
GET    /api/v1/content             # Get formatted content
POST   /api/v1/content/export      # Export to file
```

#### File Index Solution (CRITICAL)
Content aggregation requires `allFiles` array which MUST NOT be persisted:
```typescript
// CRITICAL: allFiles is EPHEMERAL - never persist to DB
// Current renderer incorrectly includes allFiles in save payload at:
// - src/hooks/use-app-state.ts:898 (line to remove)
// - src/hooks/use-app-state.ts:1352 (line to remove)

// Option A: On-demand scanning (simpler but slower)
async getContentForWorkspace(workspaceId: string) {
  const workspace = await database.getWorkspace(workspaceId);
  const allFiles = await scanDirectory(workspace.folderPath); // Reuse existing scan logic
  return getSelectedFilesContent(allFiles, workspace.state.selectedFiles, ...);
}

// Option B: In-memory cache (faster but requires state management)
class FileIndexCache {
  private cache = new Map<string, FileInfo[]>();
  
  async getOrBuild(workspaceId: string, folderPath: string) {
    if (!this.cache.has(workspaceId)) {
      const files = await scanDirectory(folderPath);
      this.cache.set(workspaceId, files);
    }
    return this.cache.get(workspaceId);
  }
  
  invalidate(workspaceId: string) {
    this.cache.delete(workspaceId);
  }
}
```

### Phase 4: Deferred Features (Week 7+)
**Complex Operations Requiring Architecture Changes**

#### Preview Pack (Renderer/Worker Proxy)
- Requires main-to-renderer IPC relay
- New channels: `cli-pack-start`, `cli-pack-status`, `cli-pack-content`
- Correlation ID for request/response pattern

#### File Tree & Search
- Option A: Build in-memory index in main process
- Option B: On-demand scanning (slower)
- Option C: Proxy to renderer (coupling issue)

## Technical Architecture

### Recommended Approach: HTTP/REST API Server

#### New Components Required
```typescript
// src/main/api-server.ts (NEW FILE - use src/main not main)
import express, { Express } from 'express';

class PasteFlowAPIServer {
  private app: Express;
  private port: number = 5839;
  private authManager: AuthManager;
  private server: any;  // http.Server instance
  
  constructor(private database: DatabaseBridge) {
    this.app = express();
    this.app.use(express.json({ limit: '10mb' }));  // CRITICAL: Enable JSON parsing
    this.setupAuth();
    this.setupRoutes();
  }
  
  private setupAuth(): void {
    // CRITICAL: Install auth middleware BEFORE routes
    this.app.use((req, res, next) => {
      if (this.authManager.validateRequest(req)) {
        next();
      } else {
        res.status(401).json({ 
          error: { 
            code: 'UNAUTHORIZED', 
            message: 'Unauthorized' 
          } 
        });
      }
    });
  }
  
  private setupRoutes(): void {
    // Map endpoints to database methods
    this.app.get('/api/v1/workspaces', async (req, res) => {
      const workspaces = await this.database.listWorkspaces();
      res.json({ data: workspaces });
    });
  }
}

// src/main/auth.ts (NEW FILE - use src/main not main)  
class AuthManager {
  private token: string;
  
  constructor() {
    this.token = this.loadOrGenerateToken();
  }
  
  validateRequest(req: Request): boolean {
    return req.headers.authorization === `Bearer ${this.token}`;
  }
}
```

### Critical Implementation Fixes

#### 1. Schema Unification
```typescript
// UPDATE src/types/file-types.ts:281-300
export interface WorkspaceState {
  selectedFolder: string | null;
  // DELETE allFiles from interface - it should not be persisted
  selectedFiles: SelectedFileReference[];
  expandedNodes: Record<string, boolean>;
  sortOrder: string;
  searchTerm: string;
  fileTreeMode: FileTreeMode;
  exclusionPatterns: string[];
  userInstructions: string;
  tokenCounts: { [filePath: string]: number };
  systemPrompts: SystemPrompt[];    // Move to top level (from customPrompts.systemPrompts)
  rolePrompts: RolePrompt[];        // Move to top level (from customPrompts.rolePrompts)
  // DELETE customPrompts nested object
  selectedInstructions?: Instruction[];
  savedAt?: number;
}

// UPDATE renderer persistence to exclude allFiles:
// src/hooks/use-app-state.ts:894-919 (saveWorkspace)
// Remove line 898: allFiles: allFiles,
// Change lines 913-916 from:
//   customPrompts: {
//     systemPrompts: promptState.selectedSystemPrompts,
//     rolePrompts: promptState.selectedRolePrompts
//   },
// To:
//   systemPrompts: promptState.selectedSystemPrompts,
//   rolePrompts: promptState.selectedRolePrompts,

// src/hooks/use-app-state.ts:1348-1372 (performAutoSave)
// Remove line 1352: allFiles: allFiles,
// Change lines 1367-1370 from:
//   customPrompts: {
//     systemPrompts: promptState.selectedSystemPrompts,
//     rolePrompts: promptState.selectedRolePrompts
//   },
// To:
//   systemPrompts: promptState.selectedSystemPrompts,
//   rolePrompts: promptState.selectedRolePrompts,

// Also update the dependency arrays to remove allFiles (lines 927 and 1381)

// DROP legacy table AND index in database-implementation.ts
// DELETE lines 219-225: Complete CREATE TABLE IF NOT EXISTS custom_prompts block
// DELETE line 241: CREATE INDEX IF NOT EXISTS idx_prompts_name ON custom_prompts(name)

// Add test to ensure these strings don't exist:
test('database schema should not contain custom_prompts artifacts', async () => {
  const schemaCode = fs.readFileSync('src/main/db/database-implementation.ts', 'utf8');
  expect(schemaCode).not.toContain('custom_prompts');
  expect(schemaCode).not.toContain('idx_prompts_name');
});
```

#### 2. Path Validator Fix
```typescript
// UPDATE src/security/path-validator.ts:15-29
constructor(workspacePaths: string[]) {
  this.allowedBasePaths = new Set(workspacePaths.map(p => normalizePath(p)));
  this.blockedPaths = new Set([
    '/etc',
    '/sys', 
    '/proc',
    '/root',
    '/boot',
    'C:/Windows/System32',    // Changed from C:\\Windows\\System32
    'C:/Windows/SysWOW64',    // Changed from C:\\Windows\\SysWOW64
    'C:/Windows/System',      // Changed from C:\\Windows\\System
    'C:/Windows/Boot',        // Changed from C:\\Windows\\Boot
    // DELETE the following overly broad patterns:
    // '/Users/*/.*',         // Line 25 - REMOVE
    // '/home/*/.*',          // Line 26 - REMOVE
    // 'C:\\Users\\*\\.*',  // Line 27 - REMOVE
  ]);
}

// UPDATE validatePath() method (lines 32-72) - reorder to allow-first logic:
validatePath(inputPath: string): ValidationResult {
  // ... existing validation up to line 53 ...
  
  // MOVE lines 61-69 (workspace check) BEFORE lines 54-59 (blocked paths)
  // New order:
  
  // 1. FIRST check if within allowed workspace (allow-first)
  if (this.allowedBasePaths.size > 0) {
    const isInWorkspace = [...this.allowedBasePaths]
      .some(basePath => resolved.startsWith(basePath + '/') || resolved === basePath);
    
    if (isInWorkspace) {
      // Path is within workspace - allow it (including dotfiles)
      return { valid: true, sanitizedPath: resolved };
    }
  }
  
  // 2. THEN check against blocked paths (for paths outside workspace)
  for (const blockedPath of this.blockedPaths) {
    if (resolved.startsWith(blockedPath) || this.matchesPattern(resolved, blockedPath)) {
      return { valid: false, reason: 'BLOCKED_PATH' };
    }
  }
  
  // 3. Reject if not in workspace and not blocked (outside workspace)
  return { valid: false, reason: 'OUTSIDE_WORKSPACE' };
}

// ADD method to PathValidator class:
getAllowedPaths(): string[] {
  return Array.from(this.allowedBasePaths);
}

// IMPORTANT: Use getPathValidator([folderPath]) to update the global singleton
// Do NOT create local pathValidator variables
// When active workspace changes, call: getPathValidator([workspace.folderPath])
```

#### 3. Active Workspace Implementation
```typescript
// In API server (src/main/api-server.ts)
import { getPathValidator } from '../security/path-validator';

async setActiveWorkspace(id: string): Promise<void> {
  await this.database.setPreference('workspace.active', id);
  const workspace = await this.database.getWorkspace(id);
  if (workspace?.folderPath) {
    // Update global PathValidator singleton
    getPathValidator([workspace.folderPath]);
    
    // CRITICAL: Must update main.currentWorkspacePaths for IPC consistency
    // currentWorkspacePaths is module-local in main.ts, not a global
    
    // CRITICAL: Avoid circular dependencies
    // DO NOT export from main.ts (main imports api-server, api-server imports main = deadlock)
    
    // CREATE NEW MODULE: src/main/workspace-context.ts
    // let allowedPaths: string[] = [];
    // export function setAllowedWorkspacePaths(paths: string[]) {
    //   allowedPaths = paths;
    //   getPathValidator(paths);  // Update singleton
    // }
    // export function getAllowedWorkspacePaths(): string[] {
    //   return allowedPaths;
    // }
    
    // Then in BOTH main.ts and api-server.ts:
    import { setAllowedWorkspacePaths } from './workspace-context';
    setAllowedWorkspacePaths([workspace.folderPath]);
  }
}
```

#### 5. Database Updates by ID
```typescript
// ADD to database-implementation.ts after line 395 (updateWorkspace method):
async updateWorkspaceById(id: number, state: WorkspaceState): Promise<void> {
  this.ensureInitialized();
  await executeWithRetry(async () => {
    const stateJson = JSON.stringify(state);
    const result = this.statements.updateWorkspaceById.run(stateJson, id);
    if (result.changes === 0) {
      throw new Error(`Workspace with id '${id}' not found`);
    }
  }, {
    operation: 'update_workspace_by_id'
  });
}

// ADD prepared statement in prepareStatements() method after line 279:
updateWorkspaceById: this.db!.prepare(`
  UPDATE workspaces 
  SET state = ?, updated_at = strftime('%s', 'now') * 1000 
  WHERE id = ?
`),

// ALSO ADD wrapper in database-bridge.ts:
async updateWorkspaceById(id: string, state: WorkspaceState): Promise<void> {
  if (!this.initialized || !this.db) {
    throw new Error('Database not initialized');
  }
  return this.db.updateWorkspaceById(Number(id), state);
}
```

#### 6. Remove In-Memory Fallbacks
```typescript
// DELETE from main.ts lines 27-36:
// type WorkspaceData = { ... };
// const workspaceStore = new Map<string, WorkspaceData>();
// const preferencesStore = new Map<string, unknown>();

// UPDATE all IPC handlers to remove fallback logic:
// For example, in /workspace/list handler (lines 626-647):
// Remove lines 634-646 (workspaceStore fallback)
// Replace with:
if (!database || !database.initialized) {
  return { success: false, error: 'DB_NOT_INITIALIZED' };
}

// CRITICAL: On DB init failure in whenReady (after line 267):
// Add after database initialization attempt:
if (!database || !database.initialized) {
  console.error('Database initialization failed - cannot start application');
  app.exit(1);  // Fail fast for CLI mode
}
```

#### 7. Instruction ID Generation  
```typescript
// In API server endpoint handler
app.post('/api/v1/instructions', async (req, res) => {
  const { id = crypto.randomUUID(), name, content } = req.body;
  
  try {
    await this.database.createInstruction(id, name, content);
    // Return full object with timestamps
    const created = {
      id,
      name,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    res.json({ data: created });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      res.status(409).json({ 
        error: { 
          code: 'DUPLICATE_INSTRUCTION', 
          message: 'Instruction with this ID already exists' 
        }
      });
    } else {
      throw error;
    }
  }
});
```

#### 8. Remove Schema Inconsistencies
```typescript
// UPDATE src/main/ipc/schemas.ts:120-127 (InstructionSchema)
export const InstructionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  content: z.string(),
  // DELETE line 124: category: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

// UPDATE src/main/ipc/schemas.ts:129-133 (InstructionCreateSchema)
export const InstructionCreateSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string(),
  // DELETE line 132: category: z.string().optional()
});

// UPDATE src/main/ipc/schemas.ts:63-68 (FileContentResponseSchema)
// DELETE unused fields - simpler is better:
export const FileContentResponseSchema = z.object({
  content: z.string(),
  tokenCount: z.number().int()
  // DELETED: hash and compressed fields (lines 66-67)
});
```

#### 4. Token Service Integration
```typescript
// Use service directly, not main wrapper (which only returns number)
// Main wrapper at src/main/main.ts:67-76 narrows to just count
import { getMainTokenService } from '../services/token-service-main';

async getTokenCount(text: string): Promise<TokenCountResult> {
  const service = getMainTokenService();
  return await service.countTokens(text); // Returns { count, backend }
}

// For GET /tokens/backend endpoint:
async getTokenBackend(): Promise<string> {
  const service = getMainTokenService();
  // TokenService has getActiveBackend() method (line 169-198 in token-service.ts)
  const backend = service.getActiveBackend();
  return backend || 'estimate';  // Return 'estimate' if null
}
```

#### 9. loadGitignore Deduplication
```typescript
// UPDATE src/utils/ignore-utils.ts:13 to add optional parameter:
export const loadGitignore = (
  rootDir: string,
  userPatterns?: string[]  // ADD this parameter
): IgnoreFilter => {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, ".gitignore");
  
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    ig.add(gitignoreContent);
  }
  
  // Add default ignores
  ig.add([".git", "node_modules", ".DS_Store"]);
  ig.add(excludedFiles);
  
  // ADD after line 26: Apply user patterns if provided
  if (userPatterns?.length) {
    ig.add(userPatterns);
  }
  
  return ig;
};

// DELETE main.ts lines 95-111 (local loadGitignore implementation)
// UPDATE main.ts line 379 to use shared util:
// Change from: const ig = loadGitignore(rootDir, userExclusionPatterns);
// To: import at top: import { loadGitignore } from '../utils/ignore-utils';
//     Then use: const ig = loadGitignore(rootDir, userExclusionPatterns);
```

#### 10. DatabaseBridge Fallback Control
```typescript
// UPDATE database-bridge.ts:48 to support options:
interface InitializeOptions {
  maxRetries?: number;
  retryDelay?: number;
  allowInMemoryFallback?: boolean;  // Default true for backward compatibility
}

async initialize(
  optionsOrMaxRetries?: number | InitializeOptions,
  retryDelay?: number
): Promise<void> {
  // Parse options for backward compatibility
  const options: InitializeOptions = typeof optionsOrMaxRetries === 'object'
    ? optionsOrMaxRetries
    : { 
        maxRetries: optionsOrMaxRetries, 
        retryDelay,
        allowInMemoryFallback: true  // Default for existing code
      };
  
  const maxRetries = options.maxRetries ?? 3;
  const delay = options.retryDelay ?? 1000;
  const allowFallback = options.allowInMemoryFallback ?? true;
  
  // ... existing retry logic (lines 49-98) ...
  
  // UPDATE lines 99-110 to check flag:
  if (allowFallback) {
    // Existing in-memory fallback code (lines 100-109)
    console.error('All database initialization attempts failed, trying in-memory fallback');
    try {
      this.db = new PasteFlowDatabase(':memory:');
      await this.db.initializeDatabase();
      this.initialized = true;
      console.warn('Database initialized in memory mode - data will not persist');
    } catch (memoryError) {
      console.error('Failed to initialize in-memory database:', memoryError);
      throw lastError || new Error('Database initialization failed');
    }
  } else {
    // Fail fast for CLI server
    console.error('Database initialization failed - failing fast (no in-memory fallback)');
    throw lastError || new Error('Database initialization failed');
  }
}

// CLI server startup in api-server.ts:
await database.initialize({ allowInMemoryFallback: false });
```

#### 13. API Server Status Endpoint
```typescript
// GET /api/v1/status implementation
// Must derive active workspace from database, not module-local variables

async getStatus(): Promise<StatusResponse> {
  // Get active workspace ID from preferences
  const activeWorkspaceId = await this.database.getPreference('workspace.active');
  
  let activeWorkspace = null;
  let allowedPaths: string[] = [];
  
  if (activeWorkspaceId) {
    activeWorkspace = await this.database.getWorkspace(activeWorkspaceId);
    if (activeWorkspace?.folderPath) {
      allowedPaths = [activeWorkspace.folderPath];
    }
  }
  
  // NOTE: If PathValidator.getAllowedPaths() method is added:
  // const validator = getPathValidator();
  // const allowedPaths = validator.getAllowedPaths();
  
  // OTHERWISE: Derive from active workspace as shown above
  
  return {
    status: 'running',
    version: app.getVersion(),
    activeWorkspace: activeWorkspace ? {
      id: activeWorkspace.id,
      name: activeWorkspace.name,
      folderPath: activeWorkspace.folderPath
    } : null,
    securityContext: {
      allowedPaths
    }
  };
}
```

## API Response Formats

### Workspace Response
```json
{
  "data": {
    "id": "123",
    "name": "my-project",
    "folderPath": "/Users/dev/project",  // Use camelCase for consistency
    "state": { /* WorkspaceState */ },
    "createdAt": 1234567890,  // Use camelCase
    "updatedAt": 1234567890   // Use camelCase
  }
}
```

### Token Count Response
```json
{
  "data": {
    "count": 1250,
    "backend": "tiktoken"  // or "estimate" or "worker-pool"
  }
}
```

### Error Response
```json
{
  "error": {
    "code": "FILE_NOT_FOUND",  // Standardized error codes
    "message": "File does not exist",
    "details": {
      "path": "/path/to/file.ts"
    }
  }
}
```

### Error Code Catalog
```typescript
enum ErrorCodes {
  // File System Errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PATH_DENIED = 'PATH_DENIED',
  BINARY_FILE = 'BINARY_FILE',
  
  // Workspace Errors
  WORKSPACE_NOT_FOUND = 'WORKSPACE_NOT_FOUND',
  NO_ACTIVE_WORKSPACE = 'NO_ACTIVE_WORKSPACE',
  
  // Database Errors
  DB_NOT_INITIALIZED = 'DB_NOT_INITIALIZED',
  DB_OPERATION_FAILED = 'DB_OPERATION_FAILED',
  
  // Auth Errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  
  // General
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}
```

## CLI Tool Structure

```typescript
// cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { PasteFlowClient } from './client';

const program = new Command();  // CRITICAL: Must declare program
const client = new PasteFlowClient();

program
  .command('workspace list')
  .action(async () => {
    const workspaces = await client.listWorkspaces();
    console.table(workspaces);
  });

program.parse(process.argv);  // CRITICAL: Must parse arguments

// cli/src/client.ts
import axios, { AxiosInstance } from 'axios';  // CRITICAL: Import axios types
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class PasteFlowClient {
  private api: AxiosInstance;
  
  constructor() {
    const token = this.loadAuthToken();
    const port = this.loadServerPort();
    
    this.api = axios.create({
      baseURL: `http://127.0.0.1:${port}/api/v1`,
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }
  
  private loadAuthToken(): string {
    const tokenPath = path.join(os.homedir(), '.pasteflow', 'auth.token');
    return fs.readFileSync(tokenPath, 'utf8').trim();
  }
  
  private loadServerPort(): number {
    const portPath = path.join(os.homedir(), '.pasteflow', 'server.port');
    return parseInt(fs.readFileSync(portPath, 'utf8').trim());
  }
}
```

## Security Considerations

### Authentication
- Token stored in `~/.pasteflow/auth.token` with 600 permissions
- No automatic rotation (stability for CLI scripts)
- Token generated on first server start

```typescript
// Secure token/port file setup in API server:
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const configDir = path.join(os.homedir(), '.pasteflow');

// Create directory with secure permissions
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
}

// Generate auth token ONLY if not present (don't overwrite on restart)
const tokenPath = path.join(configDir, 'auth.token');
if (!fs.existsSync(tokenPath)) {
  const authToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, authToken, { mode: 0o600 });
}

// Write port file (can overwrite as port may change)
const portPath = path.join(configDir, 'server.port');
fs.writeFileSync(portPath, String(this.port), { mode: 0o644 });

// Store server instance for cleanup
this.server = this.app.listen(this.port, '127.0.0.1');

// CRITICAL: Add lifecycle cleanup
// In main.ts app.on('before-quit') handler (lines 273-317):
if (apiServer?.server) {
  apiServer.server.close();  // Free port before exit
}
```

### Path Validation
- Remove overly broad dotfile blocks
- Keep critical system path blocks
- Validate within workspace boundaries

### Network Security
- Bind to 127.0.0.1 only (no external access)
- No CORS needed for localhost
- Connection timeout: 5 seconds

## Migration Plan

### Prerequisites
1. Add `express` and `@types/express` to dependencies
2. Fix WorkspaceState schema mismatch
3. Remove broad PathValidator blocks
4. Implement active workspace preference

#### Workspace Rename Implementation
```typescript
// POST /api/v1/workspaces/:id/rename implementation:
async renameWorkspace(id: string, newName: string) {
  // Fetch workspace by ID to get current name
  const workspace = await database.getWorkspace(id);
  if (!workspace) throw new Error('Workspace not found');
  
  // Use existing rename method that takes old/new names
  await database.renameWorkspace(workspace.name, newName);
  return { success: true };
}

// FIX IPC rename handler at src/main/main.ts:773-791
ipcMain.handle('/workspace/rename', async (_e, params) => {
  try {
    const { id, newName } = zSchemas.WorkspaceRenameSchema.parse(params);
    
    if (database && database.initialized) {
      // FIX: Resolve workspace by id first to get current name
      const workspace = await database.getWorkspace(id);
      if (!workspace) {
        return { success: false, error: 'Workspace not found' };
      }
      
      // Call rename with correct parameters (oldName, newName)
      await database.renameWorkspace(workspace.name, newName);
      return { success: true, data: null };
    }
    
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});
```

### Phase 1 Deliverables (Week 1-2)
- [ ] HTTP server running on port 5839
- [ ] Token authentication working
- [ ] Workspace CRUD endpoints
- [ ] Instructions CRUD with UUID generation
- [ ] Preferences get/set
- [ ] Basic CLI tool

### Phase 2 Deliverables (Week 3-4)
- [ ] Single file content endpoint
- [ ] Token counting with full response shape
- [ ] Current folder operations
- [ ] File metadata endpoint

### Phase 3 Deliverables (Week 5-6)
- [ ] File selection mutations
- [ ] Content aggregation (with file index solution)
- [ ] Export functionality
- [ ] Renderer state sync

### Phase 4 Deliverables (Week 7+)
- [ ] Preview pack proxy
- [ ] File tree operations
- [ ] Search functionality
- [ ] Database logging tables

## Success Metrics

### Technical Metrics
- API response time < 100ms (p95)
- Zero data corruption incidents
- 99.9% API availability
- < 1% error rate

### Adoption Metrics
- 100+ daily active CLI users within 3 months
- Integration with 5+ development tools
- 10+ community-contributed scripts

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Schema mismatch breaks UI | High | Comprehensive testing, no migration needed (breaking OK) |
| Port conflicts | Medium | Dynamic port allocation, scanning |
| State sync issues | High | Event broadcasting, mutex locks |
| Security vulnerabilities | High | Security audit, minimal attack surface |
| PathValidator platform issues | High | Platform-aware normalization, cross-platform testing |
| Token counting inconsistency | Medium | Always use TokenService directly, never wrapper |
| File index missing for aggregation | High | Build in-memory index or scan on-demand |
| Database ID type mismatch | Medium | Normalize ID handling, accept both numeric and string |

## Conclusion

This revised PRD provides a realistic implementation path based on actual codebase analysis. The primary challenge is the complete absence of HTTP server infrastructure, requiring significant new development. The phased approach prioritizes immediately implementable features (database operations) while deferring complex renderer-dependent features (preview pack, file tree) to later phases.

All findings are backed by specific code references, ensuring implementation accuracy.

## Critical Implementation Checklist

#### 11. Prompts Persistence Strategy (CHOOSE ONE)
```typescript
// PROBLEM: Prompts currently stored in TWO places:
// 1. Local storage via use-prompt-state.ts:15-27
// 2. Inside workspace state (nested under customPrompts)
// This creates duplication and drift

// RECOMMENDED SOLUTION: Store prompts in workspace DB only
// 1. Remove local storage usage in use-prompt-state.ts
// 2. Store prompts at top-level in WorkspaceState (systemPrompts, rolePrompts)
// 3. Load prompts from workspace on mount

// In src/hooks/use-prompt-state.ts - REMOVE:
// const [systemPrompts, setSystemPrompts] = usePersistentState<SystemPrompt[]>(
//   STORAGE_KEYS.SYSTEM_PROMPTS, []
// );
// const [rolePrompts, setRolePrompts] = usePersistentState<RolePrompt[]>(
//   STORAGE_KEYS.ROLE_PROMPTS, []
// );

// REPLACE WITH:
// Get prompts from workspace state passed as props
// Update prompts by calling workspace update methods

// ALTERNATIVE: Global prompt library + workspace selections
// - Keep prompts in separate DB table (like instructions)
// - Store only selected prompt IDs in workspace
// - More complex but allows sharing prompts across workspaces
```

#### 12. IPC Field Normalization to camelCase
```typescript
// CRITICAL: IPC currently returns DB snake_case fields directly
// Must normalize to camelCase for consistency with API and Zod schemas

// ADD mapper utility at top of main.ts after imports:
function mapWorkspaceDbToIpc(workspace: any) {
  return {
    id: String(workspace.id),
    name: workspace.name,
    folderPath: workspace.folder_path,     // snake_case to camelCase
    state: workspace.state,
    createdAt: workspace.created_at,       // snake_case to camelCase
    updatedAt: workspace.updated_at,       // snake_case to camelCase
    lastAccessed: workspace.last_accessed  // snake_case to camelCase
  };
}

function mapInstructionDbToIpc(instruction: any) {
  return {
    id: instruction.id,
    name: instruction.name,
    content: instruction.content,
    createdAt: instruction.created_at,     // snake_case to camelCase
    updatedAt: instruction.updated_at      // snake_case to camelCase
  };
}

// UPDATE workspace list handler (main.ts lines 626-647):
ipcMain.handle('/workspace/list', async () => {
  try {
    if (database && database.initialized) {
      const workspaces = await database.listWorkspaces();
      // Use mapper function instead of inline mapping
      const shaped = workspaces.map(mapWorkspaceDbToIpc);
      return { success: true, data: shaped };
    }
    return { success: false, error: 'DB_NOT_INITIALIZED' };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

// UPDATE workspace load handler (main.ts lines 681-705) similarly:
// Use: const shaped = mapWorkspaceDbToIpc(workspace);

// UPDATE instructions list handler (main.ts lines 794-801):
const list = await database.listInstructions();
const shaped = list.map(mapInstructionDbToIpc);
return { success: true, data: shaped };
```

### BREAKING CHANGES - Aggressive Cleanup (NO BACKWARD COMPATIBILITY)

#### Database Schema Breaking Changes
1. [ ] **DROP** `custom_prompts` table entirely (lines 219-225) - no migration
2. [ ] **DROP** `idx_prompts_name` index (line 241) - no migration
3. [ ] **ADD** migration to DROP tables on startup if they exist
4. [ ] **FORCE** new database schema - users start fresh

#### Code Removal (Delete, Don't Deprecate)
5. [ ] **DELETE** `/Users/*/.*`, `/home/*/.*`, `C:\Users\*\.*` from PathValidator (lines 25-27)
6. [ ] **DELETE** workspaceStore and preferencesStore entirely (lines 27-36)
7. [ ] **DELETE** all fallback code paths in IPC handlers
8. [ ] **DELETE** in-memory database fallback (lines 99-110 in database-bridge.ts)
9. [ ] **DELETE** main.ts loadGitignore function (lines 95-111)
10. [ ] **DELETE** allFiles from WorkspaceState interface and persistence (lines 898, 1352)
11. [ ] **DELETE** customPrompts nesting - flatten to top level
12. [ ] **DELETE** category from Instruction schemas (lines 124, 132)
13. [ ] **DELETE** hash/compressed from FileContentResponseSchema (lines 66-67)

#### Required New Implementation (No Compatibility Layers)
14. [ ] **REPLACE** PathValidator with allow-first logic - no compatibility
15. [ ] **CREATE** workspace-context.ts module - required, no fallback
16. [ ] **FORCE** camelCase in all IPC responses - break existing consumers
17. [ ] **REQUIRE** database on startup - app.exit(1) if unavailable
18. [ ] **USE** TokenService directly - remove number-only wrapper
19. [ ] **UPDATE** autosave signature to exclude heavy fields
20. [ ] **FIX** IPC rename handler to resolve id->name correctly

### Server Implementation Requirements
1. [ ] Create Express app with `express.json({ limit: '10mb' })` middleware
2. [ ] Install auth middleware BEFORE routes
3. [ ] Bind to 127.0.0.1:5839 ONLY (no 0.0.0.0)
4. [ ] Generate auth token ONLY if not present (don't overwrite on restart)
5. [ ] Store auth token with chmod 0o600 (best-effort on Windows, ignore errors)
6. [ ] Use TokenService directly for full { count, backend } response (NOT main wrapper)
7. [ ] Use TokenService.getActiveBackend() for /tokens/backend endpoint (return 'estimate' if null)
8. [ ] Generate UUID for instructions when ID not provided
9. [ ] Update security context when loading workspace (use workspace-context module)
10. [ ] Fail fast if database unavailable (no fallbacks)
11. [ ] Start server after DB init, before createWindow()
12. [ ] Close server on app.before-quit to free port
13. [ ] Map DB snake_case to API camelCase for consistency
14. [ ] Handle workspace rename by resolving id->name first
15. [ ] Normalize IPC errors to consistent API error codes
16. [ ] Implement dynamic port allocation (5839, then 5839+1..+20 if busy)
17. [ ] Write discovered port to ~/.pasteflow/server.port

### Testing Requirements

#### Unit Tests
1. [ ] PathValidator allows .env/.github inside workspace
2. [ ] PathValidator blocks system paths outside workspace  
3. [ ] Cross-platform path normalization (Windows + POSIX)
4. [ ] Token API returns { count, backend } shape
5. [ ] Workspace update by ID works correctly
6. [ ] Workspace update by ID returns 404 for non-existent ID
7. [ ] Instruction creation with auto-generated ID
8. [ ] Database operations with non-existent IDs
9. [ ] DatabaseBridge fails fast with no in-memory fallback
10. [ ] loadGitignore accepts and applies optional user patterns
11. [ ] IPC returns camelCase fields for workspaces/instructions
12. [ ] Renderer persistence excludes allFiles from saved state
13. [ ] Workspace state uses top-level prompts (not nested)
14. [ ] Autosave signature excludes heavy fields (allFiles)
15. [ ] Workspace context module synchronizes allowed paths
16. [ ] IPC rename handler resolves ID to name correctly
17. [ ] Error normalization maps IPC errors to API error codes
18. [ ] Custom prompts table and index don't exist in schema

#### Integration Tests  
1. [ ] API server health check endpoint
2. [ ] Auth middleware accepts valid token
3. [ ] Auth middleware rejects invalid/missing token
4. [ ] Workspace CRUD operations through API
5. [ ] Instructions CRUD with server-generated ID
6. [ ] Preferences get/set operations
7. [ ] File content denial for binary/special files
8. [ ] Active workspace updates security context

#### Performance/Regression Tests
1. [ ] Directory scan performance remains stable
2. [ ] Token counting handles large files (>100KB)
3. [ ] Database operations don't block main thread
4. [ ] API response times < 100ms (p95)

## Approach: Break Everything, Rebuild Better

### Non-Negotiable Principles
1. **NO backward compatibility** - Breaking changes are preferred
2. **NO migration paths** - Users start fresh with new version
3. **NO fallbacks** - Fail fast on any error
4. **NO legacy support** - Delete old code aggressively
5. **NO compatibility layers** - One way to do things
6. **NO feature flags** - Single code path only
7. **NO deprecation warnings** - Delete immediately

### Simplification Strategy
| Component | Old Approach | New Approach |
|-----------|--------------|---------------|
| Database | In-memory fallback | Required, fail without it |
| Workspace Schema | Nested, complex | Flat, simple |
| IPC | Mixed snake_case/camelCase | camelCase only |
| Errors | Multiple formats | Single error catalog |
| File Storage | Persisted allFiles | Never persist files |
| Prompts | Nested in customPrompts | Top-level only |
| Legacy Tables | Keep for compatibility | DROP on startup |

## Conclusion

This PRD takes an aggressive approach to modernizing PasteFlow by:
1. **Breaking all backward compatibility** - Users must start fresh
2. **Deleting all legacy code** - No migration paths or fallbacks
3. **Simplifying architecture** - One way to do things, fail fast on errors
4. **Forcing modern patterns** - camelCase everywhere, flat schemas, required database

The implementation will be simpler and cleaner by avoiding any compatibility concerns. All legacy code, fallbacks, and migration paths are eliminated in favor of a clean-slate approach.