# Your Task: Fix Remaining Linter and TypeScript Issues in PasteFlow Codebase

## Context
You are tasked with fixing the remaining linter errors and warnings in the PasteFlow codebase, an Electron-based developer tool. The codebase has already had 694 issues auto-fixed, leaving 356 issues (62 errors, 294 warnings) that require manual intervention.

## Current State
- **TypeScript**: ✅ No compilation errors (strict mode enabled)
- **ESLint**: 62 errors, 294 warnings remaining after auto-fix
- **Build System**: Electron + React + TypeScript + Vite
- **Testing**: Jest with Testing Library

## Project Structure
```
/Users/nicobailon/Documents/development/pasteflow/
├── src/                 # React renderer process
├── src/main/           # Electron main process
├── src/workers/        # Web Workers
├── cli/src/            # CLI implementation
├── build/              # Build outputs
└── scripts/            # Build and utility scripts
```

## Critical Guidelines

### 1. DO NOT Change These
- **DO NOT** disable ESLint rules globally
- **DO NOT** use `any` type to bypass TypeScript errors
- **DO NOT** remove `process.exit()` from CLI files - these are acceptable in CLI context
- **DO NOT** change module resolution configuration
- **DO NOT** modify the build system configuration

### 2. Testing Requirements
- Run `npm run lint` after each batch of fixes to verify progress
- Run `npx tsc --noEmit` to ensure no TypeScript errors are introduced
- Test that the application still builds: `npm run build`

## Issues to Fix

### Priority 1: Errors (62 total)

#### 1.1 Nested Template Literals (2 occurrences)
- **Files**: `cli/src/commands/content.ts:26`, `cli/src/commands/preview.ts:181`
- **Fix**: Extract inner template literals to variables
- **Example**:
  ```typescript
  // Before
  const msg = `Error: ${`nested ${value}`}`;
  
  // After
  const innerMsg = `nested ${value}`;
  const msg = `Error: ${innerMsg}`;
  ```

#### 1.2 Empty Block Statements (3 occurrences)
- **Files**: `cli/src/commands/preview.ts:52,57,192`
- **Fix**: Add appropriate error handling or comments explaining intentional empty blocks
- **Example**:
  ```typescript
  // Before
  catch (error) {}
  
  // After
  catch (error) {
    // Intentionally ignored - non-critical operation
  }
  ```

#### 1.3 Prefer Top-Level Await (1 occurrence)
- **File**: `build.ts:39`
- **Fix**: Remove async IIFE and use top-level await
- **Example**:
  ```typescript
  // Before
  (async () => {
    await doSomething();
  })();
  
  // After
  await doSomething();
  ```

#### 1.4 Array Push Multiple Calls (1 occurrence)
- **File**: `cli/src/commands/files.ts:38`
- **Fix**: Combine multiple push calls
- **Example**:
  ```typescript
  // Before
  arr.push(item1);
  arr.push(item2);
  
  // After
  arr.push(item1, item2);
  ```

#### 1.5 Prefer Ternary Expressions (7 occurrences)
- **Files**: Various worker and utility files
- **Fix**: Convert simple if-else to ternary
- **Example**:
  ```typescript
  // Before
  if (condition) {
    value = a;
  } else {
    value = b;
  }
  
  // After
  value = condition ? a : b;
  ```

#### 1.6 String Methods Updates (2 occurrences)
- **File**: `src/workers/preview-generator-worker.ts:154,157`
- **Fix**: Use `codePointAt()` instead of `charCodeAt()`
- **Example**:
  ```typescript
  // Before
  str.charCodeAt(index)
  
  // After
  str.codePointAt(index)
  ```

#### 1.7 Useless Switch Case (1 occurrence)
- **File**: `src/workers/preview-generator-worker.ts:351`
- **Fix**: Remove unnecessary default case or add meaningful action

#### 1.8 Redundant Jump Statement (1 occurrence)
- **File**: `src/utils/worker-base/streaming-worker-base.ts:241`
- **Fix**: Remove unnecessary return/break/continue

### Priority 2: High-Impact Warnings

#### 2.1 Cognitive Complexity (16 functions)
**Critical Functions Needing Refactoring**:
- `src/workers/preview-generator-worker.ts:448` (complexity: 61)
- `src/main/api-server.ts` (complexity: 99)
- `cli/src/commands/preview.ts:23` (complexity: 76)

**Refactoring Strategy**:
1. Extract helper functions for repeated logic
2. Use early returns to reduce nesting
3. Split complex conditionals into named boolean variables
4. Consider using strategy pattern for switch statements with many cases

#### 2.2 Module Resolution Issues (66 warnings)
**Pattern**: `Unable to resolve path to module '@constants'`, `@file-ops/path`, etc.

**Fix**: These are TypeScript path aliases. Ensure tsconfig.json paths are correctly configured:
```json
{
  "compilerOptions": {
    "paths": {
      "@constants": ["./src/constants/index.ts"],
      "@file-ops/*": ["./src/file-ops/*"],
      "@/*": ["./src/*"]
    }
  }
}
```

#### 2.3 CommonJS to ESM Migration
- **Files**: `build.ts`, `__mocks__/fileMock.ts`
- **Issues**: `__dirname`, `module.exports`
- **Fix**: 
  ```typescript
  // Before
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  module.exports = stub;
  
  // After
  import { fileURLToPath } from 'url';
  import { dirname } from 'path';
  const __dirname = dirname(fileURLToPath(import.meta.url));
  export default stub;
  ```

### Priority 3: Acceptable Warnings (Don't Fix)

#### 3.1 CLI process.exit() Usage (84 warnings)
- **Location**: All `cli/src/commands/*.ts` files
- **Action**: KEEP AS IS - These are appropriate for CLI tools
- **Note**: The linter warning is overly strict for CLI applications

#### 3.2 Unused Variables Following Convention
- **Pattern**: Variables prefixed with `_` are intentionally unused
- **Action**: KEEP AS IS - This follows the project's naming convention

### Priority 4: File Naming
- **File**: `__mocks__/fileMock.ts`
- **Issue**: Filename doesn't match exported name 'stub'
- **Fix**: Either rename file to `stub.ts` or change export name to match filename

## Implementation Order

1. **Phase 1**: Fix all actual errors (Priority 1)
   - Start with simple fixes (empty blocks, array push)
   - Move to template literals and string methods
   - Handle ternary conversions last

2. **Phase 2**: Address module resolution (Priority 2.2)
   - Verify tsconfig.json path mappings
   - Ensure all imports use correct aliases

3. **Phase 3**: Refactor high-complexity functions (Priority 2.1)
   - Start with highest complexity scores
   - Extract helper functions
   - Add unit tests for refactored code

4. **Phase 4**: CommonJS to ESM migration (Priority 2.3)
   - Update build.ts and mock files
   - Ensure build still works

## Validation Commands

Run these after each phase:
```bash
# Check linting
npm run lint

# Check TypeScript
npx tsc --noEmit

# Check build
npm run build

# Run tests
npm test
```

## Special Considerations

### For Worker Files
- Workers run in separate contexts - be careful with imports
- Path aliases might not work the same way in workers
- Test worker functionality after changes

### For CLI Files  
- CLI files are meant to be run as command-line tools
- `process.exit()` is appropriate and should not be removed
- Console output is expected and intentional

### For Database Files
- Database operations are in a worker thread
- Be careful with async/await patterns
- Maintain transaction integrity

## Expected Outcome

After completing all fixes:
- ✅ 0 TypeScript errors
- ✅ ~62 fewer ESLint errors (reduced to 0)
- ✅ ~100-150 ESLint warnings (mostly process.exit in CLI)
- ✅ All tests passing
- ✅ Application builds and runs correctly

## Files Requiring Most Attention

1. `src/workers/preview-generator-worker.ts` - 8 issues including high complexity
2. `src/main/api-server.ts` - Highest complexity (99)
3. `cli/src/commands/preview.ts` - High complexity (76) + nested templates
4. `src/main/db/database-worker.ts` - Multiple switch case issues
5. `cli/src/commands/content.ts` - Complexity + nested template

## DO NOT

- ❌ Add `// eslint-disable` comments without justification
- ❌ Change TypeScript strict mode settings
- ❌ Modify `.eslintrc` or `tsconfig.json` rules
- ❌ Use `@ts-ignore` or `@ts-expect-error`
- ❌ Rename files without updating all imports
- ❌ Break existing functionality to satisfy linter

## Notes for Implementation

1. Create a git branch before starting: `git checkout -b fix-linter-issues`
2. Commit after each phase for easy rollback if needed
3. If a fix causes cascading issues, evaluate if the linter rule should be adjusted instead
4. Document any intentional rule violations with clear comments
5. Run the application manually after fixes to ensure functionality

## Success Metrics

The task is complete when:
1. All fixable errors are resolved
2. High-complexity functions are refactored
3. Module resolution warnings are fixed
4. The application builds and runs without issues
5. All tests pass
6. No new TypeScript errors are introduced

Remember: The goal is to improve code quality while maintaining functionality. If a linter rule conflicts with the project's architecture or requirements, document why and move on.