# Plan: Remove SecureDatabase and Secure IPC Path

## Objective
Permanently remove the SecureDatabase implementation and the SECURE_IPC execution path (including SecureIpcLayer) to reduce complexity and user friction, keeping the stable DatabaseBridge-based architecture as the sole database path.

## High-level Approach
- Stage the removal to avoid user disruption and to keep rollbacks trivial.
- First disable the feature flag path in dev and runtime, then delete code and dependencies, then clean up docs/tests/build.
- Validate at each stage with builds, smoke runs, and tests.

## Current Footprint (Authoritative Inventory)
- Feature flag and runtime wiring
  - main.js
    - Reads `process.env.SECURE_IPC === '1'` to gate loading compiled modules from `./build/main/...`
    - When true, attempts to require:
      - `./build/main/ipc/secure-ipc.js` (SecureIpcLayer)
      - `./build/main/handlers/state-handlers.js` (StateHandlers)
      - `./build/main/db/secure-database.js` (SecureDatabase)
    - Initializes SecureDatabase at `pasteflow-secure.db` when enabled
  - dev.js
    - Starts Electron with `SECURE_IPC=1` after building TS main layer
  - package.json
    - Script: `start:secure` sets `SECURE_IPC=1`
- Secure DB stack (TypeScript)
  - src/main/db/secure-database.ts (uses keytar, crypto, AsyncDatabase, schema/migrations)
  - src/main/db/async-database.ts (Worker-thread wrapper)
  - src/main/db/database-worker.js (worker implementation)
  - src/main/db/connection-pool.ts, pooled-database.ts, pooled-database-bridge.ts, pool-config.ts (pooling/perf)
  - src/main/db/retry-utils.{ts,js}, shared-buffer-utils.ts (support utilities)
  - src/main/db/schema.sql, src/main/db/migrations/* (schema/migrations for the secure path)
  - src/main/db/database-manager.ts (initializes SecureDatabase + SecureIpcLayer + StateHandlers)
  - src/main/db/index.ts (re-exports SecureDatabase and other secure-path types)
- Secure IPC
  - src/main/ipc/secure-ipc.ts (validation layer)
  - src/main/ipc/index.ts (exports SecureIpcLayer)
- Docs and plans
  - src/main/db/README.md (describes SQLCipher/keychain-based architecture)
  - secure-database-migration-plan-opus.md
- Tests likely tied to secure path
  - src/main/db/__tests__/security-test.ts
  - src/main/db/__tests__/async-database-test.ts
  - src/main/db/__tests__/connection-pool-test.ts
  - src/main/db/__tests__/benchmarks.ts
- Dependencies used only by the secure path (to confirm by grep before removal)
  - keytar
  - node-machine-id

Legacy/Kept Path (authoritative)
- src/main/db/database-implementation.js (better-sqlite3)
- src/main/db/database-bridge.js (async wrapper, fallback to in-memory)
- main.js legacy handlers already work when SECURE_IPC is disabled

## Risks & Constraints
- Build scripts and dev workflow currently set SECURE_IPC=1 (dev.js). Must remove to prevent accidental code paths.
- Types and exports in `src/main/db/index.ts` and `src/main/ipc/index.ts` must be adjusted to avoid dangling imports.
- Tests referencing secure modules will fail until removed/rewritten.
- Some users may have a `pasteflow-secure.db` from experimental builds. Decide on migration or ignore.

## Staged Removal Plan

### Phase 0 – Freeze and baseline
1. Ensure team alignment: We are deprecating SecureDatabase entirely; DatabaseBridge remains the only DB.
2. Create a branch `chore/remove-secure-db` for all work; keep changes atomic per phase.
3. Baseline: run existing unit tests and ensure the legacy app path currently works.

### Phase 1 – Disable the feature in dev/runtime (no functionality change)
1. dev.js
   - Stop setting `SECURE_IPC=1` when launching Electron.
   - Keep TS build step if still needed by other tooling, but plan to remove later.
2. package.json
   - Remove `start:secure` script.
3. main.js
   - Default `useSecureIpc` to false (or remove the ENV check entirely in Phase 2).
   - Keep fallback to legacy handlers as-is.
4. Verify
   - `npm run dev:electron` launches successfully.
   - Smoke test core features (workspaces, preferences) using legacy DB.

### Phase 2 – Remove Secure path code and exports (small, targeted refactor)
1. main.js
   - Remove SECURE_IPC-based conditional requires and the entire SecureDatabase/SecureIpcLayer boot path.
   - Keep only legacy handler registration and window creation.
2. src/main/ipc/index.ts
   - Remove `export { SecureIpcLayer }` and any now-unused exports.
3. src/main/db/index.ts
   - Remove `export { SecureDatabase }` and any pool-related exports that become unused.
4. src/main/db/database-manager.ts
   - Delete this file if only used by the Secure path (verify via global search). If referenced elsewhere, replace with legacy equivalents or remove references.
5. Verify
   - Grep/build to ensure no remaining imports of SecureDatabase, SecureIpcLayer, or database-manager.
   - App builds and runs; tests compile.

### Phase 3 – Delete Secure stack files
Delete after search confirms no references:
- src/main/db/secure-database.ts
- src/main/db/async-database.ts
- src/main/db/database-worker.js
- src/main/db/connection-pool.ts
- src/main/db/pooled-database.ts
- src/main/db/pooled-database-bridge.ts
- src/main/db/pool-config.ts
- src/main/db/shared-buffer-utils.ts
- src/main/db/schema.sql (secure schema; ensure legacy does not use it)
- src/main/db/migrations/*
- src/main/ipc/secure-ipc.ts
- src/main/handlers/state-handlers.ts
- Docs: secure-database-migration-plan-opus.md
- If src/main/db/README.md is specific to secure path (SQLCipher/Keychain), replace contents with DatabaseBridge docs in Phase 5.

Keep (shared by legacy):
- src/main/db/retry-utils.js and src/main/db/retry-utils.ts

### Phase 4 – Remove dependencies and build-time artifacts
1. Dependencies
   - Remove `keytar` via package manager: `npm uninstall keytar`
   - Remove `node-machine-id` if unused elsewhere: verify, then `npm uninstall node-machine-id`
2. Build/Dev scripts
   - Remove `build:main` and any scripts only used to compile the TS main-layer used exclusively by the Secure path (verify `scripts/build-main-ts.js` usage; delete if now dead).
   - Remove any references to `build/main/...` from code and scripts.
3. Packaging
   - Confirm electron-builder config doesn’t reference removed artifacts; no changes expected.

### Phase 5 – Docs and tests
1. Replace src/main/db/README.md
   - Document the maintained legacy architecture: DatabaseBridge + better-sqlite3, schema, and reliability features.
2. Remove/replace tests
   - Delete secure-path tests: `security-test.ts`, `async-database-test.ts`, `connection-pool-test.ts`, `benchmarks.ts`.
   - Add tests for DatabaseBridge to retain coverage on CRUD, retry behavior, fallback to in-memory, and edge cases.
3. Update any developer docs mentioning SECURE_IPC or SecureDatabase.

### Phase 6 – Optional: handle legacy secure DB files
- On startup, detect `pasteflow-secure.db` in userData. Options:
  - Log a one-time warning and ignore.
  - Or migrate by copying (if file is actually unencrypted; if encrypted, skip with info). Since secure path was not production, simplest is to ignore and optionally remove with user consent.

### Phase 7 – Validation and Rollback
- Validation
  - `npm run lint` and `npm test` pass.
  - `npm run dev:electron` launches; key flows work (open workspace, browse files, preferences).
  - Packaging smoke test: `npm run package:mac` (or platform) builds and app launches.
- Rollback plan
  - Revert the branch to restore Secure path (kept only for rollback until we’re confident), then permanently delete after a release.

## Concrete Work Items (Checklist)
- [ ] Phase 1: Disable SECURE_IPC in dev.js and remove start:secure script in package.json
- [ ] Phase 2: Remove SECURE_IPC code path from main.js and adjust src/main/ipc/index.ts and src/main/db/index.ts exports
- [ ] Phase 2: Remove/replace references to src/main/db/database-manager.ts
- [ ] Phase 3: Delete secure-related files listed above after verifying no references
- [ ] Phase 4: `npm uninstall keytar` and, if unused, `npm uninstall node-machine-id`
- [ ] Phase 4: Remove dead build-main TS scripts if no longer needed
- [ ] Phase 5: Update src/main/db/README.md to document the legacy DB architecture
- [ ] Phase 5: Remove secure-path tests; add DatabaseBridge tests
- [ ] Phase 6: Optional: add non-destructive check for leftover pasteflow-secure.db
- [ ] Phase 7: Validate dev run, tests, and packaging

## Acceptance Criteria
- No remaining references to SecureDatabase, SecureIpcLayer, SECURE_IPC, or secure TS/worker modules
- App runs with only DatabaseBridge in all modes; no keychain prompts
- CI passes with updated test suite; packaging succeeds
- keytar (and node-machine-id if unused) removed from dependencies
- Docs accurately reflect the supported DB architecture

## Notes
- Keep edits small and verifiable per commit; prefer a PR per phase.
- Before deleting any file, grep for references to ensure no accidental breakages.
- If any shared utility (e.g., retry-utils) is used by legacy code, move it to an appropriate location and keep it; otherwise delete.

