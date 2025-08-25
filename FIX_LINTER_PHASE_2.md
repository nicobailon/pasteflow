# Phase 2: Refactor High Complexity Functions and CLI Issues

## Scope
This is Phase 2 of 3 for fixing linter issues in the PasteFlow codebase. This phase focuses on **reducing cognitive complexity** in critical functions and addressing **CLI-specific patterns**.

**Target: Reduce complexity in ~8 functions, fix ~20 errors, ~100 warnings**

## Prerequisites
- Phase 1 must be completed
- Working directory: `/Users/nicobailon/Documents/development/pasteflow/`
- Create a new branch from Phase 1: `git checkout -b fix-linter-phase-2`

## High Complexity Functions to Refactor

### 1. CRITICAL: API Server Complexity (99)
**File:** `src/main/api-server.ts`

**Refactoring approach:**
```typescript
// Extract route handlers into separate functions
function handleWorkspaceRoutes(app: Express) {
  // Move all /workspace routes here
}

function handleFileRoutes(app: Express) {
  // Move all /files routes here
}

function handleContentRoutes(app: Express) {
  // Move all /content routes here
}

// Extract validation logic
function validateFileRequest(req: Request): ValidationResult {
  // Centralize file validation
}

// Extract error handling
function createErrorResponse(error: unknown): ErrorResponse {
  // Standardize error responses
}
```

### 2. Preview Command Complexity (76)
**File:** `cli/src/commands/preview.ts:23`

**Refactoring approach:**
```typescript
// Break down the main function into smaller pieces:

async function handleStartCommand(options: StartOptions) {
  const config = await loadConfiguration(options);
  const validation = validateInputs(config);
  if (!validation.valid) return handleValidationError(validation);
  
  return executePreview(config);
}

function validateInputs(config: Config) {
  // Extract all validation logic
}

function buildPreviewRequest(options: Options) {
  // Extract request building
}

async function waitForCompletion(id: string, options: Options) {
  // Extract waiting logic
}
```

### 3. Preview Generator Worker Complexity (61)
**File:** `src/workers/preview-generator-worker.ts:448`

**Refactoring approach:**
```typescript
// Identify the complex function and break it down:

// Extract switch cases into a map or strategy pattern
const processors = new Map([
  ['type1', processType1],
  ['type2', processType2],
]);

function processMessage(type: string, data: any) {
  const processor = processors.get(type);
  if (!processor) {
    return handleUnknownType(type);
  }
  return processor(data);
}

// Extract nested conditionals
function shouldProcessFile(file: FileInfo): boolean {
  if (!file) return false;
  if (file.isBinary) return false;
  if (file.size > MAX_SIZE) return false;
  return true;
}
```

### 4. Content Command Complexity (34)
**File:** `cli/src/commands/content.ts:17`

**Refactoring approach:**
```typescript
// Extract file writing logic
async function writeContentToFile(content: string, options: Options) {
  const outputPath = resolveOutputPath(options);
  await validateOutputPath(outputPath, options);
  return fs.writeFile(outputPath, content);
}

// Extract progress reporting
function reportProgress(current: number, total: number, options: Options) {
  if (!options.quiet) {
    console.log(`Progress: ${current}/${total}`);
  }
}
```

### 5. Files Command Complexity (33)
**File:** `cli/src/commands/files.ts:65`

**Refactoring approach:**
```typescript
// Simplify the content command handler
async function handleContentCommand(filePath: string, options: Options) {
  const steps = [
    validatePath,
    fetchContent,
    processContent,
    outputContent
  ];
  
  for (const step of steps) {
    const result = await step(filePath, options);
    if (result.error) return handleError(result.error);
  }
}
```

### 6. Database Worker Complexity
**File:** `src/main/db/database-worker.ts`

**Focus areas:**
- Extract message handlers into separate functions
- Simplify switch statements
- Reduce nesting in transaction handling

### 7. Preview Generator Worker Additional Function (34)
**File:** `src/workers/preview-generator-worker.ts:777`

**Similar approach to #3 above**

### 8. Streaming Tree Builder Complexity (35)
**File:** `src/utils/streaming-tree-builder.ts:48`

**Refactoring approach:**
```typescript
// Extract tree node creation
function createTreeNode(file: FileInfo, options: TreeOptions): TreeNode {
  // Consolidate node creation logic
}

// Extract sorting logic
function sortTreeNodes(nodes: TreeNode[], options: SortOptions): TreeNode[] {
  // Separate sorting concerns
}
```

## CLI-Specific Improvements

### Handle process.exit() Patterns
**Note:** Keep process.exit() but improve error handling around it

```typescript
// Improve error handling before exit
function exitWithError(message: string, code: number = 1) {
  console.error(formatError(message));
  if (options.debug) {
    console.error(getDebugInfo());
  }
  process.exit(code);
}

// Standardize success exits
function exitWithSuccess(message?: string) {
  if (message) console.log(message);
  process.exit(0);
}
```

### Standardize CLI Error Handling
**Files:** All `cli/src/commands/*.ts`

```typescript
// Create a shared error handler
export function handleCommandError(error: unknown, options: Options) {
  if (axios.isAxiosError(error)) {
    return handleApiError(error, options);
  }
  
  if (error instanceof ValidationError) {
    return handleValidationError(error, options);
  }
  
  // Default handling
  console.error('Unexpected error:', error);
  process.exit(1);
}
```

## Module Resolution Fixes (Continued)

Fix remaining import issues in:
- `src/main/db/*.ts` files
- `src/utils/*.ts` files
- `src/hooks/*.ts` files

## Validation Steps

After each refactoring:
```bash
# Check complexity reduction
npm run lint 2>&1 | grep "cognitive-complexity"

# Ensure functionality preserved
npm test -- --testPathPattern=<refactored-file>

# Check type safety
npx tsc --noEmit
```

## Commit Strategy

```bash
# One commit per major refactoring
git commit -m "refactor: reduce api-server complexity from 99 to <30"
git commit -m "refactor: simplify preview command handler"
git commit -m "refactor: extract preview generator strategies"
```

## Success Criteria for Phase 2

✅ All functions with complexity > 30 are refactored
✅ API server complexity reduced to < 30
✅ Preview command complexity reduced to < 30
✅ Standardized error handling in CLI
✅ At least 20 more import warnings resolved
✅ Database worker switch statements simplified

## What NOT to Do in Phase 2

❌ Don't remove process.exit() from CLI
❌ Don't change business logic while refactoring
❌ Don't skip tests after refactoring
❌ Don't combine unrelated refactorings in one commit

## Testing Focus Areas

Critical paths to test after refactoring:
1. API server endpoints: `curl http://localhost:<port>/api/v1/status`
2. CLI commands: `node cli/dist/index.js preview start --help`
3. Database operations: Workspace save/load
4. Preview generation: Full preview workflow

## Complexity Reduction Techniques

1. **Extract Method**: Pull out logical chunks into named functions
2. **Early Return**: Reduce nesting with guard clauses
3. **Strategy Pattern**: Replace large switches with map/strategy
4. **Pipeline Pattern**: Chain operations instead of nesting
5. **Extract Variable**: Name complex conditions

Example:
```typescript
// Before: High complexity
function process(data) {
  if (data) {
    if (data.type === 'A') {
      if (data.value > 10) {
        // deep nesting
      }
    }
  }
}

// After: Reduced complexity
function process(data) {
  if (!data) return;
  if (!isTypeA(data)) return;
  if (!isHighValue(data)) return;
  
  return processHighValueTypeA(data);
}
```

## Next Phase Preview

Phase 3 will handle:
- Remaining worker file issues
- CommonJS to ESM migration
- Final warning cleanup
- Module resolution completion

## Final Check

Before moving to Phase 3:
```bash
# Complexity warnings should be mostly gone
npm run lint 2>&1 | grep -c "cognitive-complexity"  # Should be < 5

# Error count further reduced
npm run lint 2>&1 | tail -5

# All tests passing
npm test
```