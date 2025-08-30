# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PasteFlow is an Electron-based developer tool designed to streamline AI coding workflows. It allows developers to browse, select, and copy code from repositories in an optimized format for AI interaction, with features like token counting, smart file exclusion, and XML diff application.

**Key Technologies:**
- **Electron** (v34.3.0) - Desktop application framework
- **React** (v18.2.0) with TypeScript - UI framework with strict typing
- **Vite** (v5.0.8) - Build tool and development server
- **Jest** (v29.7.0) with Testing Library - Testing framework
- **tiktoken** (v1.0.20) - Token counting for LLM context estimation
- **ignore** (v7.0.3) - GitIgnore pattern matching for file exclusions
- **@xmldom/xmldom** (v0.9.6) - XML parsing for diff application
- **better-sqlite3** (v11.7.0) - SQLite database for data persistence
- **Worker Threads** - Database operations in separate thread for performance

## Architecture Overview

### Application Structure
```
src/
├── components/          # React UI components (kebab-case naming)
├── hooks/               # Custom React hooks for state management
├── types/               # TypeScript type definitions
├── file-ops/            # Path/filters/ascii-tree utilities (renderer-safe)
├── utils/               # Utility functions and helpers
├── handlers/            # Electron IPC and event handlers
├── context/             # React context providers
├── constants/           # Application constants and configurations
├── security/            # Security validation utilities
├── main/                # Electron main process
│   ├── db/              # SQLite database layer
│   ├── ipc/             # IPC schemas/routes
│   └── utils/           # Main process utilities
└── __tests__/           # Test files co-located with source
```

### Core Architecture Patterns

#### 1. Hooks-Based State Management
The application uses a custom hook architecture instead of traditional state management:
- `useAppState()` - Central application state and logic
- `useFileSelectionState()` - File selection with line-range support
- `usePromptState()` - System and role prompts management
- `useModalState()` - Modal visibility and state
- `useWorkspaceState()` - Workspace persistence and loading
- `usePreviewPack()` - Progressive preview pack workflow management

#### 2. Electron Main/Renderer Split
- **Main Process** (`src/main/main.ts`) - File system operations, security validation, IPC handlers
- **Renderer Process** (`src/`) - React UI with strict security boundaries
- **Preload Script** (`src/main/preload.ts`) - Secure IPC bridge

#### 3. File Processing Pipeline
```
Directory Scan → Batch Processing → Lazy Content Loading → Token Counting → UI Display
```

#### 4. Progressive Preview Pack Workflow
```
Pack (Background Processing) → Ready State → Preview/Copy Actions
```
- Background file loading without UI blocking
- Deterministic signature-based caching
- State machine for workflow management (idle → packing → ready)

## Development Environment

### Prerequisites
- Node.js (v14+)
- npm or equivalent package manager

### Development Commands

```bash
# Development
npm run dev              # Start Vite dev server (port 3000)
npm run dev:electron     # Start Electron in development mode

# Building
npm run build           # Build React app with Vite
npm run build-electron  # Build and prepare for Electron
npm run package         # Create distributable packages
npm run verify-build    # Verify build integrity
npm run test-build      # Test local build

# Testing
npm test               # Run Jest tests
npm run test:watch     # Tests in watch mode

# Code Quality
npm run lint           # ESLint with TypeScript support
npm run lint:strict    # ESLint with zero warnings tolerance
npm run lint:filenames # Enforce kebab-case file naming

# TypeScript Type Checking
npx tsc --noEmit       # Run TypeScript compiler to check for type errors
                       # Note: No npm script for this, use npx directly
```

### Build Process
1. **Vite Build** - Compiles React/TypeScript to `dist/`
2. **Main/Preload Compile** - Compiles Electron main/preload TypeScript to CommonJS (`build/main`)
3. **Electron Builder** - Packages for multiple platforms; packaging hooks are compiled TS in `build/scripts`

## First‑Party CLI (Commander + Axios)

The repository includes a first‑party CLI that communicates with the local HTTP API hosted by the Electron main process. It is intended for automation and headless workflows and mirrors key UI capabilities: workspaces CRUD, instructions, preferences, file metadata/content, selection management, content aggregation/export, and preview (async).

Location and bootstrap
- Entry point: [cli/src/index.ts](cli/src/index.ts)
- HTTP client, discovery, error mapping: [cli/src/client.ts](cli/src/client.ts)
- Commands implemented under: [cli/src/commands/](cli/src/commands/)
  - status, workspaces, folders, instructions, prefs, files, tokens, select, content, preview, tree

Build and usage
- Build the CLI:
  ```bash
  npm run build:cli
  # or in watch mode
  npm run build:cli:watch
  ```
- Run locally:
  ```bash
  node cli/dist/index.js status
  ```
- Global bin (dev):
  ```bash
  npm link
  pasteflow status
  # alias also available:
  pf status
  ```

Global flags
- --host, --port, --token: override discovery from ~/.pasteflow/{server.port,auth.token}
- --json: machine‑readable output (prints raw success/error payloads)
- --raw: emit raw content for file/content/preview content
- --timeout <ms>: HTTP timeout (default ~10s)
- --debug: HTTP request/response summaries to stderr
- -h, --help, --h: show help for any command

Exit codes
- 0 success
- 1 general/server error (INTERNAL_ERROR, FILE_SYSTEM_ERROR)
- 2 validation or path denied (VALIDATION_ERROR, NO_ACTIVE_WORKSPACE)
- 3 authentication failure (UNAUTHORIZED)
- 4 not found
- 5 conflict/binary (CONFLICT, BINARY_FILE, local EEXIST)
- 6 server not running/unreachable

Key commands (examples)
- Status
  ```bash
  pasteflow status
  pasteflow status --include-selection   # adds per-file tokens table; JSON includes fileTreeMode + selectionSummary
  ```
- Workspaces
  ```bash
  pasteflow workspaces list
  pasteflow workspaces create --name "WS" --folder "/abs/path"
  pasteflow workspaces load <id>
  ```
- Files (absolute paths enforced client‑side)
  ```bash
  pasteflow files info --path "/abs/path/file.ts"
  pasteflow files content --path "/abs/path/file.ts" --out out.txt --overwrite
  ```
- Selection
  ```bash
  pasteflow select add --path "/abs/path/file.ts" --lines "10-20,30"
  # Token breakdown for current selection (files + prompts/instructions)
  pasteflow select list [--summary-only] [--relative] [--max-files 500] [--max-bytes 2000000] [--no-include-instructions] [--no-include-prompts]
  # Text output includes current File Tree Mode; --json adds fileTreeMode
  ```
  
  Tokens
  ```bash
  pasteflow tokens backend
  pasteflow tokens count --text @README.md
  # Alias for selection token breakdown (same as `select list`)
  pasteflow tokens selection [--summary-only] [--relative] [--max-files 500] [--max-bytes 2000000] [--no-include-instructions] [--no-include-prompts]
  ```
- Content aggregation
  ```bash
  pasteflow content get --max-files 500 --max-bytes 2000000 --out pack.txt --overwrite
  pasteflow content export --out "/abs/path/pack.txt" --overwrite
  ```
- Tree
  ```bash
  pasteflow tree                      # ASCII file tree for active workspace/mode
  pasteflow tree --json               # JSON { mode, root, tree }
  pasteflow tree --list-modes         # List available file tree modes
  pasteflow tree --mode selected      # Override mode for this call (does not change workspace)
  ```
  Notes:
  - `pasteflow tree --list-modes` marks the current mode with `* - current`.
- Preview (async)
  ```bash
  pasteflow preview start --prompt @prompt.txt --follow --out preview.md --overwrite
  pasteflow preview status <id> --watch
  pasteflow preview content <id> --raw
  pasteflow preview cancel <id>
  ```

Error mapping and guidance
- CLI normalizes server errors via handleAxiosError and preserves envelopes when --json is set.
- If you encounter NO_ACTIVE_WORKSPACE, initialize or load one:
  ```bash
  pasteflow folders open --folder "/your/repo"
  # or
  pasteflow workspaces load <id>
  ```
- Only files and select enforce absolute paths in the CLI; server remains the source of truth for path validation.

HTTP API reference
- The HTTP API is defined in [src/main/api-server.ts](src/main/api-server.ts) and covers:
  - /api/v1/status, /workspaces, /instructions, /prefs, /files/info|content,
    /tokens/count|backend, /files/select|deselect|clear|selected, /content, /content/export,
    /selection/tokens, /tree (optional query ?mode=<none|selected|selected-with-roots|complete>),
    /preview/start|status/:id|content/:id|cancel/:id

Selection tokens example
```bash
curl -H "Authorization: Bearer $(cat ~/.pasteflow/auth.token)" \
     "http://127.0.0.1:5839/api/v1/selection/tokens?relativePaths=true&maxFiles=100"
```
Response (truncated):
```json
{
  "backend": "tiktoken",
  "files": [
    { "path": "/abs/path/src/app.ts", "relativePath": "src/app.ts", "ranges": null, "bytes": 1234, "tokenCount": 456, "partial": false, "skipped": false, "reason": null }
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

## Development Guidelines

### TypeScript Standards
- **Strict Mode Enabled** - All strict TypeScript options are active
- **No `any` Types** - Exhaust all proper solutions before considering type widening
- **Branded Types** - Use branded types for domain-specific strings
- **Type Precision** - Maintain exact types; widening is considered a failure

### Component Architecture
- **Functional Components** - All components use React hooks
- **Props Interfaces** - Every component has a defined TypeScript interface
- **Kebab-Case Files** - Component files use kebab-case naming (e.g., `file-card.tsx`)
- **Single Responsibility** - Components focus on one concern

### State Management Patterns
```typescript
// ✅ CORRECT: Use the central useAppState hook
const appState = useAppState();

// ✅ CORRECT: Destructure needed functionality
const { selectedFiles, toggleFileSelection, loadFileContent } = appState;

// ❌ AVOID: Direct state manipulation
// setFiles([...files, newFile]); // Use the hook methods instead
```

### File Naming Conventions
- **Components**: `kebab-case.tsx` (e.g., `system-prompt-card.tsx`)
- **Hooks**: `use-{name}.ts` (e.g., `use-app-state.ts`)
- **Utils**: `kebab-case.ts` (e.g., `file-processing.ts`)
- **Types**: `kebab-case.ts` (e.g., `file-types.ts`)

## Testing Philosophy

PasteFlow follows strict behavior-driven testing principles documented in [`TESTING.md`](./TESTING.md).

### Behavior-Driven Testing
Focus on **what the application should accomplish**, not how it's implemented:

```typescript
// ✅ GOOD: Tests business behavior
it('should exclude binary files from token counting', () => {
  const files = [
    { name: 'code.js', isBinary: false },
    { name: 'image.png', isBinary: true }
  ];
  
  const result = calculateTokens(files);
  expect(result.totalTokens).toBeGreaterThan(0);
  expect(result.excludedFiles).toContain('image.png');
});

// ❌ BAD: Tests implementation details
it('should call processFile method', () => {
  const spy = jest.spyOn(processor, 'processFile');
  processor.handleFiles(files);
  expect(spy).toHaveBeenCalled();
});
```

### Test Quality Standards (MANDATORY)
- **Assertion Density**: Minimum 2 assertions per test
- **Mock Limit**: Maximum 3 mocks per test file  
- **No Skipped Tests**: All tests must run (no .skip or .todo)
- **Error Handling**: Use `expect().rejects` instead of try/catch
- **Real Behavior**: Test actual outcomes, not implementation details

### Test Structure Requirements
- **Co-located Tests** - Test files in `src/__tests__/`
- **Descriptive Names** - Test names explain expected behavior
- **Real Data** - Use realistic test data, not minimal examples
- **Test Independence** - Each test is isolated and can run in any order
- **Edge Case Coverage** - Test boundary conditions and error scenarios

### Testing Anti-Patterns (FORBIDDEN)
- Empty try-catch blocks that hide failures
- Tests that only verify mocks return what you told them to return
- Tests without assertions or with single assertions
- Tests that depend on execution order
- Tests that mock the entire system under test
- Snapshot tests without complementary behavioral assertions

### Exemplary Test Patterns
Study these files for best practices:
- `src/__tests__/apply-changes-test.ts` - Real file system testing
- `src/__tests__/workspace-validation-test.ts` - Business logic validation  
- `src/__tests__/filter-modal-test.tsx` - UI interaction testing

## Security Considerations

### Path Validation
All file system operations go through security validation:
```typescript
// Path validation is mandatory for all file operations
const validator = getPathValidator(currentWorkspacePaths);
const validation = validator.validatePath(filePath);
if (!validation.valid) {
  // Handle security violation
}
```

### IPC Security
- **Rate Limiting** - IPC calls are rate-limited to prevent abuse
- **Input Validation** - All IPC inputs are validated and sanitized
- **Workspace Boundaries** - File access is restricted to selected workspaces

## Performance Patterns

### Lazy Loading
Files content is loaded on-demand to handle large codebases:
```typescript
// Content is loaded only when needed
const loadFileContent = useCallback(async (filePath: string) => {
  if (file.isContentLoaded) return;
  
  // Check cache first
  const cached = fileContentCache.get(filePath);
  if (cached) {
    // Use cached content
    return;
  }
  
  // Load from backend
  const result = await requestFileContent(filePath);
  // Cache and update state
}, []);
```

### Batch Processing
Directory scanning uses batching to prevent UI freezing:
- **Batch Size**: 50 files per batch
- **Cancellation Support** - Users can cancel long-running operations
- **Progress Feedback** - Real-time processing status updates
- **IPC Rate Limiting** - Prevents excessive communication between processes

### Memory Management
- **Content Caching** - File contents are cached with eviction policies
- **Selective Loading** - Only selected files have content loaded
- **Binary File Exclusion** - Binary files are detected and excluded from processing

### Database Performance
- **Worker Thread Isolation** - Database operations don't block the main thread
- **Prepared Statements** - Reusable queries for optimal performance
- **Transaction Batching** - Multiple operations wrapped in transactions
- **Automatic Migration** - Seamless upgrade from localStorage to SQLite

## Common Patterns

### File Selection with Line Ranges
```typescript
// Files can be selected with specific line ranges
interface SelectedFileWithLines {
  path: string;
  lines?: LineRange[];  // undefined = entire file
  content?: string;
  tokenCount?: number;
}
```

### Workspace Management
```typescript
// Workspaces preserve complete application state
const saveWorkspace = (name: string) => {
  const state: WorkspaceState = {
    selectedFolder,
    selectedFiles,
    expandedNodes,
    userInstructions,
    customPrompts,
    // ... complete state
  };
  persistWorkspace(name, state);
};
```

### Token Counting Integration
```typescript
// Token counting is central to the application
const tokens = await tokenService.countTokens(content); // Facade (renderer/main)
const estimate = estimateTokenCount(text); // Fallback estimation
```

## Integration Points

### AI Platform Integration
- **Content Formatting** - Files are formatted for AI consumption
- **Token Awareness** - All content includes token estimates for LLM limits

### File System Integration
- **GitIgnore Support** - Respects `.gitignore` patterns
- **Binary Detection** - Automatically excludes binary files
- **Cross-Platform Paths** - Handles Windows/Unix path differences

## Troubleshooting

### Common Development Issues

1. **Module Loading Errors**
   - Check that dependencies are in the correct sections of `package.json`
   - Critical modules (`tiktoken`, `ignore`) must be in `asarUnpack` for Electron
   - Run `npm run verify-build` to check packaging

2. **Path Resolution Issues**
   - Electron uses `file://` protocol in production
   - Use relative paths in built assets
   - `build.js` script handles path fixing for production

3. **IPC Communication Failures**
   - Verify security validation isn't blocking requests
   - Check that all IPC handlers are properly registered in `main.js`
   - Rate limiting may throttle excessive requests

4. **Test Failures**
   - Ensure tests meet quality standards (≥2 assertions, ≤3 mocks)
   - Check that mocks don't replace business logic testing
   - Use temp directories for file system tests like `apply-changes-test.ts`

### Build Issues
- Run `npm run verify-build` to check build integrity
- Use `npm run test-build` for local testing
- Check `scripts/` directory for troubleshooting utilities
- Ensure all critical dependencies are in `asarUnpack` configuration

## File References Format
When referencing code locations, always use VS Code-compatible format:
- `src/hooks/use-app-state.ts:123` - single line
- `src/components/file-card.tsx:45-67` - line range
- Always use relative paths from project root

## Key Files to Understand

### Core Architecture
- `src/hooks/use-app-state.ts` - Central application state and logic
- `src/types/file-types.ts` - Core TypeScript definitions
- `src/main/main.ts` - Electron main process and file system operations

### State Management
- `src/hooks/use-file-selection-state.ts` - File selection with line ranges
- `src/hooks/use-workspace-state.ts` - Workspace persistence
- `src/hooks/use-preview-pack.ts` - Progressive preview pack workflow
- `src/handlers/electron-handlers.ts` - IPC communication setup

### UI Components
- `src/components/sidebar.tsx` - File tree and navigation
- `src/components/content-area.tsx` - Main content display
- `src/components/file-card.tsx` - Individual file representation

### Utilities
- `src/utils/token-utils.ts` - Token estimation helpers
- `src/file-ops/path.ts` - Path utilities (cross‑env)
- `src/file-ops/filters.ts` - GitIgnore/binary detection
- `src/security/path-validator.ts` - Security validation

### Background Processing
- `src/workers/preview-generator-worker.ts` - Web Worker for preview generation
- `src/hooks/use-preview-generator.ts` - Worker integration hook

### Database Layer
- `src/main/db/database-bridge.ts` - Initialization, fallback, typed IPC envelopes
- `src/main/db/async-database.ts` - Worker thread database wrapper
- `src/main/ipc/index.ts` - IPC channels and schemas

Understanding these files will provide a solid foundation for working with the PasteFlow codebase.

## Key Features to Understand

### Advanced File Selection Features
- **Line Range Selection**: Select specific line ranges within files, not just entire files
- **Token-Aware Selection**: Real-time token counting for LLM context limits
- **Workspace Persistence**: Complete application state can be saved and restored
- **Smart Exclusion**: GitIgnore-style pattern matching with validation

### Progressive Preview Pack System
- **Background Processing**: Files are processed in a Web Worker without blocking the UI
- **Pack Workflow States**: 
  - `idle` - Pack button available
  - `packing` - Shows progress, cancellable
  - `ready` - Preview and Copy buttons active
  - `error`/`cancelled` - Retry Pack button
- **Optimized Performance**: 
  - Minimal UI updates during packing
  - Deterministic signature-based caching
  - LRU cache with capacity 1 for memory efficiency
- **Seamless Experience**: Pack → Loading → Preview/Copy workflow without UI freezing

### File Tree Modes
The application supports different file tree inclusion modes:
- **None**: Just file contents
- **Selected**: Include only selected files in tree
- **Selected with Roots**: Include selected files with parent directories  
- **Complete**: Include entire directory structure

### System Prompts Management
- Create and manage reusable system prompts
- Include multiple system prompts with code selections
- Token counting includes system prompt overhead
- Persistent storage of custom prompts

I am usually running the dev server already via `npm run dev:electron` - so no need for you to run that command unless I specically ask you. Just ask me to test the app manually when necessary.

Do not commit without being asked to do so.
