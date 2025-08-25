# Phase 1: Fix Critical Errors and Simple Issues

## Scope
This is Phase 1 of 3 for fixing linter issues in the PasteFlow codebase. This phase focuses on **critical errors** and **simple mechanical fixes** that don't require complex refactoring.

**Target: Fix ~20 errors and ~100 warnings**

## Prerequisites
- Working directory: `/Users/nicobailon/Documents/development/pasteflow/`
- Ensure you can run: `npm run lint` and `npx tsc --noEmit`
- Create a git branch: `git checkout -b fix-linter-phase-1`

## Issues to Fix in This Phase

### 1. Empty Block Statements (3 errors)
**Files to fix:**
- `cli/src/commands/preview.ts` - Lines 52, 57, 192

**How to fix:**
```typescript
// Find empty catch blocks like:
catch (error) {}

// Replace with:
catch (error) {
  // Intentionally empty - non-critical operation
}

// Or if it should log:
catch (error) {
  if (options.debug) {
    console.error('Debug:', error);
  }
}
```

### 2. Nested Template Literals (2 errors)
**Files to fix:**
- `cli/src/commands/content.ts:26`
- `cli/src/commands/preview.ts:181`

**How to fix:**
```typescript
// Find nested template literals like:
const message = `Error: ${`nested ${value} here`}`;

// Extract to variable:
const details = `nested ${value} here`;
const message = `Error: ${details}`;
```

### 3. Array Push Multiple Calls (1 error)
**File to fix:**
- `cli/src/commands/files.ts:38-39`

**How to fix:**
```typescript
// Find:
headers.push(['Property', 'Value']);
headers.push(something);

// Combine:
headers.push(['Property', 'Value'], something);
```

### 4. String Method Updates (2 errors)
**File to fix:**
- `src/workers/preview-generator-worker.ts` - Lines 154, 157

**How to fix:**
```typescript
// Find all uses of:
str.charCodeAt(index)

// Replace with:
str.codePointAt(index) ?? 0
// Note: codePointAt can return undefined, handle appropriately
```

### 5. Useless Switch Case (1 error)
**File to fix:**
- `src/workers/preview-generator-worker.ts:351`

**How to fix:**
```typescript
// Find useless/empty default case:
switch (value) {
  case 'a': return 1;
  default: // nothing here
}

// Either remove default or add meaningful action:
switch (value) {
  case 'a': return 1;
  // Remove default entirely if not needed
}
```

### 6. Redundant Jump Statement (1 error)
**File to fix:**
- `src/utils/worker-base/streaming-worker-base.ts:241`

**How to fix:**
```typescript
// Find redundant return/break/continue at end of function/loop
// Remove if it's the last statement and serves no purpose
```

### 7. Prefer Top-Level Await (1 error)
**File to fix:**
- `build.ts:39`

**How to fix:**
```typescript
// Find:
(async () => {
  await main();
})();

// Replace with:
await main();
// Ensure the file is treated as a module (has import/export)
```

### 8. Prefer Ternary Expressions (7 errors)
**Files to fix:**
- `src/utils/worker-base/discrete-worker-pool-base.ts` - Lines 119, 327
- `src/utils/worker-base/streaming-worker-base.ts` - Line 110
- Check other worker files for similar patterns

**How to fix:**
```typescript
// Find simple if-else assigning to same variable:
let result;
if (condition) {
  result = valueA;
} else {
  result = valueB;
}

// Replace with:
const result = condition ? valueA : valueB;
```

### 9. Module Resolution Path Aliases (First Batch)
**Fix imports in these files first:**
- `src/workers/tree-builder-worker.ts`
- `src/workers/preview-generator-worker.ts`
- `src/utils/token-utils.ts`
- `src/utils/streaming-tree-builder.ts`

**How to fix:**
```typescript
// These imports are failing:
import { CONSTANTS } from '@constants';
import { something } from '@file-ops/path';

// Check if tsconfig.json has proper paths configuration
// If not working, use relative imports temporarily:
import { CONSTANTS } from '../constants';
import { something } from '../file-ops/path';
```

### 10. Fix File Naming Issue
**File to fix:**
- `__mocks__/fileMock.ts`

**How to fix:**
```typescript
// Current export doesn't match filename
// Either:
// Option 1: Rename file to stub.ts
// Option 2: Change export from 'stub' to match filename:
export default fileMock; // instead of stub
```

## Validation Steps

After each group of fixes, run:
```bash
# Check your progress
npm run lint 2>&1 | grep -E "^✖.*problems"

# Ensure no TypeScript errors introduced
npx tsc --noEmit

# Run specific test if available
npm test -- --testPathPattern=<affected-file>
```

## Commit Strategy

Make commits after each type of fix:
```bash
git add -p  # Review changes carefully
git commit -m "fix: resolve empty block statements in CLI"
git commit -m "fix: eliminate nested template literals"
git commit -m "fix: combine array push operations"
# etc.
```

## Success Criteria for Phase 1

✅ All empty blocks have comments or proper handling
✅ No nested template literals remain
✅ Array operations are optimized
✅ String methods are updated to modern versions
✅ No redundant code remains
✅ Simple if-else converted to ternary where appropriate
✅ At least 10 import resolution warnings fixed
✅ File naming issue resolved

## What NOT to Do in Phase 1

❌ Don't refactor complex functions yet (save for Phase 2)
❌ Don't touch process.exit() warnings in CLI files
❌ Don't modify build configuration
❌ Don't use `any` type to fix issues
❌ Don't disable ESLint rules

## Files to Focus On

Priority files for this phase:
1. `cli/src/commands/preview.ts` (multiple issues)
2. `cli/src/commands/content.ts`
3. `cli/src/commands/files.ts`
4. `src/workers/preview-generator-worker.ts`
5. `src/utils/worker-base/streaming-worker-base.ts`
6. `src/utils/worker-base/discrete-worker-pool-base.ts`
7. `build.ts`

## Next Phase Preview

Phase 2 will handle:
- High cognitive complexity functions
- Main process and API server issues
- Database worker problems

## Final Check

Before moving to Phase 2, ensure:
```bash
# Error count should be reduced by at least 10
npm run lint 2>&1 | tail -5

# Application still builds
npm run build

# Tests still pass
npm test
```

Save your progress and document any issues encountered for the next phase.