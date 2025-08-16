# Updated Plan: Remove SecureDatabase and Secure IPC Path

## Objective
Remove SecureDatabase and the SECURE_IPC execution path (including SecureIpcLayer) to reduce complexity and avoid macOS Keychain prompts. Preserve the stable DatabaseBridge + better-sqlite3 path as the sole database implementation.

## Current State Re‑Verification (as of this update)
- Feature flag and runtime wiring
  - main.js
    - Checks `process.env.SECURE_IPC === '1'` and conditionally requires built modules from `./build/main/...`:
      - `./build/main/ipc/secure-ipc.js` (SecureIpcLayer)
      - `./build/main/handlers/state-handlers.js` (StateHandlers)
      - `./build/main/db/secure-database.js` (SecureDatabase)
    - When enabled, initializes SecureDatabase at `pasteflow-secure.db`, otherwise uses DatabaseBridge and registers legacy IPC handlers guarded by `!actuallyUseSecureIpc`.
  - dev.js
    - Builds schemas and TypeScript main layer, then starts Electron with `SECURE_IPC=1`.
  - package.json
    - Contains `start:secure` script: `SECURE_IPC=1 electron .`.
- Secure path code present
  - src/main/db: secure-database.ts, async-database.ts, database-worker.js, connection-pool.ts, pooled-database.ts, pooled-database-bridge.ts, pool-config.ts, retry-utils.ts/js, shared-buffer-utils.ts, schema.sql, migrations/*, database-manager.ts, index.ts re-exporting SecureDatabase.
  - src/main/ipc: secure-ipc.ts, index.ts exporting SecureIpcLayer.
  - src/main/handlers: state-handlers.ts (used by secure path).
- Legacy path (to keep)
  - src/main/db/database-implementation.js (better-sqlite3)
  - src/main/db/database-bridge.js (async wrapper + fallback)
  - main.js initializes DatabaseBridge and registers legacy IPC when secure path not in use.
- Dependencies
  - keytar and node-machine-id are present in dependencies (keytar used by SecureDatabase; node-machine-id referenced historically for device salts).

## Corrections since the earlier draft
- retry-utils.js is used by the legacy implementation (database-implementation.js requires './retry-utils.js'). Therefore, do NOT remove retry-utils.js (and likely keep retry-utils.ts as its source). Adjust deletion list accordingly.
- src/main/handlers/state-handlers.ts is part of the secure path. Include it in the deletion list if no other references remain after removing the secure path.
- All other references listed in the draft remain accurate: SECURE_IPC is still set in dev.js and package.json; SecureDatabase and SecureIpcLayer are exported and conditionally required in main.js.

## Risks & Constraints
- Removing SECURE_IPC from dev flow is necessary to avoid the secure path during development.
- Removing SecureDatabase/SecureIpcLayer requires pruning exports in src/main/db/index.ts and src/main/ipc/index.ts to prevent dangling imports.
- Tests under src/main/db/__tests__ referencing secure modules will fail until removed/updated.
- retry-utils.js is shared with legacy; ensure it remains.

## Staged Removal Plan

### Phase 0 – Freeze and baseline
1. Create a branch `chore/remove-secure-db` for all changes.
2. Baseline: run lint and tests; verify legacy path works by ensuring SECURE_IPC is not set (or forcing the legacy branch).

### Phase 1 – Disable the feature in dev/runtime (no functionality change)
1. dev.js: stop setting `SECURE_IPC=1` when starting Electron.
2. package.json: remove `start:secure` script.
3. main.js: optionally default the toggle to false or leave as-is for now; actual removal happens in Phase 2.
4. Verify: `npm run dev:electron` loads legacy handlers and DatabaseBridge without keychain prompts.

### Phase 2 – Remove Secure path code and exports (small, targeted refactor)
1. main.js: remove the SECURE_IPC conditional requires and the SecureDatabase/SecureIpcLayer boot path; keep only DatabaseBridge and the legacy IPC handlers.
2. src/main/ipc/index.ts: remove `export { SecureIpcLayer }` (keep schema exports).
3. src/main/db/index.ts: remove `export { SecureDatabase }` and any unused pool-related exports (connection-pool, pooled-database, pooled-database-bridge, pool-config) if unreferenced.
4. src/main/db/database-manager.ts: remove if only used by secure path (currently imports SecureDatabase, SecureIpcLayer, StateHandlers).
5. src/main/handlers/state-handlers.ts: remove if only used by secure path (current usage via main.js and database-manager.ts in the secure branch).
6. Verify: grep/build to ensure no imports of SecureDatabase, SecureIpcLayer, state-handlers, or database-manager remain. App builds and runs.

### Phase 3 – Delete Secure stack files (after confirming no references)
Delete these files and directories:
- src/main/db/secure-database.ts
- src/main/db/async-database.ts
- src/main/db/database-worker.js
- src/main/db/connection-pool.ts
- src/main/db/pooled-database.ts
- src/main/db/pooled-database-bridge.ts
- src/main/db/pool-config.ts
- src/main/db/shared-buffer-utils.ts
- src/main/db/schema.sql
- src/main/db/migrations/*
- src/main/ipc/secure-ipc.ts
- src/main/handlers/state-handlers.ts
- Docs: secure-database-migration-plan-opus.md

Keep (shared by legacy):
- src/main/db/retry-utils.js (required by database-implementation.js)
- src/main/db/retry-utils.ts (source, if kept in repo)

### Phase 4 – Remove dependencies and build-time artifacts
1. Dependencies
   - `npm uninstall keytar`
   - If `node-machine-id` is unused elsewhere: `npm uninstall node-machine-id`
2. Build/Dev scripts
   - Remove `build:main` or any steps only needed to produce `./build/main/...` if the secure path was their sole consumer (verify usage in dev.js and elsewhere).
   - Remove any remaining references to `./build/main/...` from code and scripts.

### Phase 5 – Docs and tests
1. Update src/main/db/README.md to describe the DatabaseBridge + better-sqlite3 architecture and its reliability features.
2. Remove secure-path tests under src/main/db/__tests__ (e.g., security-test.ts, async-database-test.ts, connection-pool-test.ts, benchmarks.ts).
3. Add/expand DatabaseBridge tests: CRUD, retry behavior, in-memory fallback, error surfaces.
4. Update any documentation referencing SECURE_IPC/SecureDatabase.

### Phase 6 – Optional: handle legacy secure DB files
- At startup, optionally detect `pasteflow-secure.db`. Either ignore with a one-time log or prompt the user to remove. Avoid migrations unless necessary.

### Phase 7 – Validation and Rollback
- Validation
  - `npm run lint` and `npm test` pass.
  - `npm run dev:electron` launches; workspaces, preferences, and instructions flows work via DatabaseBridge.
  - Packaging smoke test (e.g., `npm run package:mac`) builds and launches.
- Rollback plan
  - Revert the branch to restore the secure path prior to final deletion if issues arise.

## Checklist
- [ ] Phase 1: Disable SECURE_IPC in dev.js and remove `start:secure` in package.json
- [ ] Phase 2: Remove SECURE_IPC path in main.js; clean exports in src/main/ipc/index.ts and src/main/db/index.ts; remove database-manager.ts and state-handlers.ts if unused
- [ ] Phase 3: Delete secure-only files (keep retry-utils.ts/js)
- [ ] Phase 4: Uninstall keytar and possibly node-machine-id; remove dead build scripts
- [ ] Phase 5: Update README and tests for DatabaseBridge-only architecture
- [ ] Phase 6: Optional secure DB file handling
- [ ] Phase 7: Validate dev run, tests, and packaging

## Acceptance Criteria
- No references to SecureDatabase, SecureIpcLayer, SECURE_IPC, or secure TS/worker modules
- App runs using DatabaseBridge only; no keychain prompts
- CI passes and packaging succeeds
- keytar (and unused node-machine-id) removed from dependencies
- Docs reflect the supported DB architecture

