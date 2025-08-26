# Phase 5 — Cognitive Complexity Reduction (Meta‑Prompt for Coding Agent)

You are a senior coding agent working in the PasteFlow repository to reduce cognitive complexity warnings without changing behavior. Follow this meta‑prompt strictly. Work surgically, iterate in small PR‑sized commits, and keep the app, tests, and TypeScript builds green at every step.

## Role & Context

- Repo: PasteFlow (React + Electron + Node scripts)
- Language/tooling: TypeScript, React, Electron, Jest, ESLint (sonarjs, unicorn, import), Vite
- Lint baseline: Cognitive complexity warnings remain in selected modules; overall warnings should drop below 50 by the end of this phase without sacrificing correctness.
- TypeScript compilation and runtime are currently clean — do not regress.

## Non‑Negotiable Constraints (Do Not Break)

- Keep all `typeof jest === 'undefined'` checks. Do NOT rewrite them (these avoid production ReferenceErrors). Suppress with `// eslint-disable-next-line unicorn/no-typeof-undefined` where needed.
- Do NOT remove `process.exit()` from CLI commands. In CLI context, exit codes are intentional and correct.
- Do NOT change public behavior, IPC contracts, or HTTP API semantics.
- Do NOT switch module formats in Electron main or Node scripts. Prefer to keep existing ESM/CJS split as is.
- Avoid broad renames/moves that break imports. Keep changes scoped.

## Environment & Commands

- Dev app: `npm run dev:electron`
- Lint: `npm run lint`
- Strict lint (optional): `npm run lint:strict`
- TypeScript check: `npx tsc --noEmit`
- Tests: `npm test`, `npm run test:unit`, `npm run test:integration`

## Objectives

- Reduce or eliminate SonarJS cognitive complexity warnings in the highest‑impact modules by refactoring into smaller, testable units with guard clauses and simpler control flow.
- Preserve behavior. Add/adjust tests as safety nets when refactoring non‑UI utilities and pure logic.
- Keep runtime functional and TypeScript builds clean.

## Target Modules (Current Hotspots)

Focus on these in order (highest complexity/benefit first). Only tackle a file if you can keep tests/TS green.

1) `src/components/content-area.tsx` (complexity ~67)
2) `src/hooks/use-file-selection-state.ts` (complexity ~81)
3) `src/hooks/use-preview-generator.ts` (complexity ~55)
4) `src/hooks/use-app-state.ts` (complexity ~39)
5) `src/utils/content-formatter.ts` (complexity ~35)
6) `src/main/content-aggregation.ts` (complexity ~48)
7) `src/main/db/database-worker.ts` (complexity ~48)
8) `src/main/main.ts` (functions with complexity > 30)

Notes:
- If a file listed above no longer triggers warnings after prior phases, skip it and move to the next.
- Feel free to include additional modules with complexity > 30 if they are strictly local helpers and easy wins.

## Refactor Patterns to Prefer

- Guard clauses/early returns to flatten nested conditionals.
- Extract pure helper functions (in the same file) for complex branches, mapping, filtering, and transforms.
- Split combined responsibilities into cohesive functions (e.g., parsing → validate → transform → format).
- For React components/hooks:
  - Move heavy calculations to memoized utilities or custom hooks.
  - Extract long event handlers/effects into named helpers.
  - Keep dependency arrays correct; isolate side effects.
- Consolidate duplicated string literals by reusing existing constants (prefer `src/constants/*` when applicable). Do not introduce broad new constant files unless clearly beneficial.
- Replace long `if/else if` ladders with strategy maps where appropriate.
- Avoid premature classes or over‑abstraction; prefer small, composable functions.
- Keep file scope/local exports to avoid churn across imports.

## File‑Specific Checklists

### 1) `src/components/content-area.tsx`
- Identify the most complex function(s) (render logic, event handlers, and effects).
- Extract pure data transforms, selection logic, and formatting to top‑level helpers.
- Convert nested conditionals into guard clauses.
- Ensure hooks’ dependency arrays remain accurate post‑extraction.
- Add unit tests for extracted pure helpers in `src/__tests__/` where feasible.

### 2) `src/hooks/use-file-selection-state.ts`
- Split selection state machine: separate pure state transitions (toggle/select/deselect) from side effects.
- Create `applySelectionChange(state, action)` style pure helper(s); ensure full test coverage of edge cases.
- Reduce parameter arity by grouping related params in objects.
- Simplify conditionals with early returns and strategy maps.

### 3) `src/hooks/use-preview-generator.ts`
- Break the large arrow function(s) into: input normalization, job orchestration, error mapping, and result formatting.
- Extract repeated branches and complexity hot‑paths to utilities.
- Add unit tests for core pure helpers (no DOM).

### 4) `src/hooks/use-app-state.ts`
- Isolate workspace preference mutations and normalization into pure helpers.
- Flatten nested conditions; consolidate repeated transformations.
- Add tests around the helpers that manipulate state.

### 5) `src/utils/content-formatter.ts`
- Separate traversal/collection from formatting.
- Replace deeply nested flow with guard clauses.
- Add tests to validate formatting output for representative cases.

### 6) `src/main/content-aggregation.ts`
- Split: request validation → data collection → aggregation → post‑processing.
- Extract file/content merge logic and filtering into pure helpers.
- Add tests in `src/main/__tests__/` using mocks/stubs for I/O.

### 7) `src/main/db/database-worker.ts`
- Decompose long functions: job scheduling, retry logic, and DB operations in separate helpers.
- Replace long conditional chains with early exits.
- Add tests with mocks (no real DB I/O) to lock behavior.

### 8) `src/main/main.ts`
- Extract long IPC handlers into small functions within the same file.
- Keep Electron app lifecycle intact; do not change environment assumptions.
- Only add tests for pure helpers; avoid E2E in this phase.

## Implementation Steps (Loop Per File)

1. Baseline
   - Run: `npm run lint` and capture current cognitive complexity warnings for the target file.
   - Run: `npm test` and `npx tsc --noEmit` to ensure green baseline.

2. Safety Net (if pure logic is involved)
   - Identify units to extract as pure helpers.
   - Add targeted unit tests for these helpers (behavioral tests, not implementation details).

3. Refactor
   - Apply the patterns above: extract helpers, guard clauses, split responsibilities.
   - Keep changes local to the file where possible to avoid import churn.
   - Ensure no changes to public behavior.

4. Verify
   - Lint: `npm run lint` (expect reduced or eliminated complexity warnings for the file).
   - TS: `npx tsc --noEmit`
   - Tests: `npm test`
   - Manual smoke: `npm run dev:electron` (spot‑check key flows related to the file if feasible).

5. Commit
   - Use conventional commits, e.g., `refactor: reduce complexity in use-preview-generator helpers`
   - Keep diffs focused, add notes on behavioral parity and tests added/updated.

Repeat steps 1–5 for each file in priority order.

## Testing Guidance

- Prefer unit tests for extracted pure helpers (e.g., transform/format/merge logic).
- For hooks/components: test via existing integration tests when feasible; otherwise, test helpers in isolation.
- For Electron main: write tests in `src/main/__tests__/` with mocks/stubs — do not hit real DB or filesystem unless already supported by mocks.
- Keep `typeof jest === 'undefined'` guards intact; do not rework them.

## Acceptance Criteria

- Lint warnings drop below 50 total, with all cognitive complexity warnings addressed for the targeted modules above (or justified if unavoidable).
- Zero ESLint errors.
- `npx tsc --noEmit` passes.
- `npm test` passes locally (no new flaky tests).
- App runs: `npm run dev:electron` works for core flows (workspace selection, tree operations, and persistence).
- No changes to public APIs or CLI exit behaviors.

## Deliverables

- Refactored modules (as listed) with reduced cognitive complexity.
- New/updated unit tests for extracted helpers.
- Short CHANGELOG in PR description summarizing risk, scope, and test coverage.

## Risk Management

- Keep commits small and reversible.
- If a refactor risks behavior changes, stop and add tests first.
- If complexity can’t be reduced without significant redesign, document the constraint and move to the next module.

## Notes

- Do not introduce new dependencies.
- Follow repository coding style and import ordering.
- Prefer minimal, readable changes over “clever” ones.

