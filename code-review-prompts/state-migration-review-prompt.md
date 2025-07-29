# State Migration Code Review Prompt

You are reviewing a state management migration in PasteFlow, an Electron-based developer tool. The migration removes legacy Jotai atoms and non-functional context providers in favor of a modern hooks-based architecture.

## Context

PasteFlow has already successfully migrated to using a centralized `useAppState` hook, but legacy code remains that needs to be removed. The migration plan can be found at: `/Users/nicobailon/Documents/development/pasteflow/implementation-plans/state-migration-plan.md`

## Your Review Objectives

### 1. Verify Complete Removal of Legacy Code

Check that all the following have been removed:
- [ ] `src/state/app-state.ts` (Jotai atoms)
- [ ] `src/state/` directory (should not exist)
- [ ] `src/hooks/use-file-system.ts`
- [ ] `src/hooks/use-ui-state.ts`
- [ ] `src/hooks/use-workspace-context.ts`
- [ ] `src/context/file-system-context.tsx`
- [ ] `src/context/ui-state-context.tsx`
- [ ] `src/context/workspace-context.tsx`
- [ ] `jotai` dependency from package.json (if not used elsewhere)

Verify that `src/context/theme-context.tsx` was NOT removed (it's functional and should remain).

### 2. Functional Equivalence Testing

Ensure the application maintains full functionality:

**Critical User Workflows to Test:**
- [ ] Opening and scanning folders
- [ ] File selection and deselection
- [ ] Line-range selection within files
- [ ] Token counting accuracy
- [ ] Workspace saving and loading
- [ ] System/role prompt management
- [ ] Search and filtering
- [ ] File tree expansion/collapse
- [ ] Copy functionality
- [ ] Theme switching (light/dark/system)

**State Persistence:**
- [ ] Selected files persist across sessions
- [ ] User instructions persist
- [ ] Sort order persists
- [ ] Search term persists
- [ ] File tree mode persists
- [ ] Exclusion patterns persist
- [ ] Theme preference persists

### 3. Code Quality Verification

**Import Analysis:**
```bash
# Run these commands to verify no dangling imports
grep -r "from ['\"].*state/app-state" src/
grep -r "from ['\"]jotai" src/
grep -r "FileSystemContext" src/
grep -r "UIStateContext" src/
grep -r "WorkspaceContext" src/
grep -r "useFileSystemState" src/
grep -r "useUIState" src/
grep -r "useWorkspaceContext" src/
```

**TypeScript Compilation:**
- [ ] `npm run typecheck` passes with zero errors
- [ ] No new `any` types introduced
- [ ] All strict mode checks pass

**Bundle Size:**
- [ ] Measure bundle size before and after migration
- [ ] Verify reduction from removing Jotai
- [ ] Check for any unexpected increases

### 4. Performance Validation

**React DevTools Profiler:**
- [ ] No increase in unnecessary re-renders
- [ ] Component mount time unchanged or improved
- [ ] No memory leaks introduced

**Key Metrics to Check:**
1. Initial app load time
2. Folder scanning performance
3. File selection responsiveness
4. Workspace switching speed
5. Memory usage during large folder operations

### 5. Test Suite Verification

Run the complete test suite and verify:
- [ ] All existing tests pass without modification
- [ ] No tests were deleted or skipped
- [ ] Code coverage remains the same or improves
- [ ] No new console warnings or errors

**Specific Test Files to Focus On:**
- `app-state-workspace-test.ts`
- `workspace-test.ts`
- `workspace-modal-test.tsx`
- `workspace-e2e-test.ts`
- `create-new-workspace-test.ts`
- `file-selection-workflow-test.tsx`

### 6. Edge Case Testing

**Boundary Conditions:**
- [ ] Empty folder selection
- [ ] Folders with 10,000+ files
- [ ] Binary file handling
- [ ] Symbolic links
- [ ] Permission-denied scenarios
- [ ] Network drives (if applicable)

**State Consistency:**
- [ ] Rapid file selection/deselection
- [ ] Workspace switching during file loading
- [ ] Canceling operations mid-process
- [ ] Multiple modal interactions

### 7. Documentation Review

Verify updates to:
- [ ] `CLAUDE.md` - Architecture section updated
- [ ] `README.md` - State management section updated (if exists)
- [ ] Inline code comments - No references to old patterns
- [ ] Type definitions - No orphaned interfaces

### 8. Security Considerations

Ensure no security regressions:
- [ ] Path validation still enforced
- [ ] IPC communication properly validated
- [ ] No exposed internal state via global objects
- [ ] LocalStorage data properly sanitized

## Review Checklist Summary

### MUST PASS Criteria:
1. ✅ All legacy code completely removed
2. ✅ Zero TypeScript errors
3. ✅ All tests passing
4. ✅ No functional regressions
5. ✅ Theme functionality preserved
6. ✅ No performance degradation

### SHOULD VERIFY:
1. 📊 Bundle size reduced
2. 🚀 Performance metrics stable/improved
3. 📝 Documentation fully updated
4. 🧹 No orphaned imports or types
5. 🔒 Security measures intact

### RED FLAGS to Watch For:
1. ❌ Any use of `any` type
2. ❌ Commented-out code instead of deletion
3. ❌ Modified tests to make them pass
4. ❌ New context providers added
5. ❌ State management inconsistencies
6. ❌ Memory leaks or performance issues

## Review Output Format

Please provide your review in the following format:

```markdown
## State Migration Code Review

### Overall Assessment
[PASS/FAIL/NEEDS WORK]

### Functional Testing Results
- [ ] All user workflows tested and working
- [ ] State persistence verified
- [ ] No regressions found

### Code Quality Analysis
- Legacy code removal: [COMPLETE/INCOMPLETE]
- TypeScript compliance: [PASS/FAIL]
- Bundle size impact: [Reduced by X KB/MB]

### Performance Impact
- Initial load: [No change/Improved by X%/Degraded]
- Memory usage: [Stable/Improved/Concerns]
- Render performance: [Maintained/Improved/Degraded]

### Issues Found
1. [Issue description and severity]
2. [Issue description and severity]

### Recommendations
1. [Specific improvement suggestions]
2. [Future considerations]

### Approval Status
[APPROVED/APPROVED WITH CONDITIONS/CHANGES REQUESTED]
```

## Additional Review Guidance

### What Success Looks Like:
- Clean, minimal diff showing only deletions
- Zero changes to business logic
- Improved application metrics
- Simplified codebase structure
- Clear git history

### Common Pitfalls to Avoid:
- Don't approve if tests were modified to pass
- Don't ignore console warnings
- Don't skip manual testing
- Don't assume backwards compatibility
- Don't overlook documentation updates

### Questions to Ask:
1. Why was this specific approach chosen?
2. Were any alternatives considered?
3. Is there technical debt being introduced?
4. Are there follow-up tasks needed?
5. How does this impact future development?

Remember: The goal is to complete the migration to a clean, modern architecture without introducing any regressions or new issues. Be thorough but pragmatic in your review.