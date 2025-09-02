## Electron Main ESM Migration Plan

STATUS: Completed. The main process now runs as ESM-only (`build/main/main.mjs`) built via tsup. Legacy CJS main scripts (`build:main`, `build:main:watch`) and `tsconfig.main.json` have been removed. Dev and packaging scripts use `build:main:esm`. Rollback instructions in this document are obsolete.

This is a concrete, step-by-step plan to migrate the Electron main build from CommonJS (CJS) to ESM with minimal disruption. It builds on the analysis in `esm-migration-analysis.md`.

Goals
- Keep renderer (Vite) unchanged
- Keep packaging scripts (CJS) unchanged
- Switch Electron main to ESM-only; preload and worker compiled as CJS runtime artifacts
- Avoid flipping repo-wide module type (no `"type": "module"` change)

Approach Summary
- Emit an ESM main entry as `.mjs` using `tsup` (recommended) or use `tsc` with NodeNext as an alternative
- Update a small set of main-side files to be ESM-safe (paths, requires)
- Add trial scripts to run ESM in dev and to package
- Validate with local runs and a test package before replacing the primary entry

---

## Phase 0: Preparation

1) Create a branch
- git checkout -b feat/main-esm

2) (Recommended) Add tsup for main build
- npm i -D tsup
- Rationale: tsup can emit `.mjs` easily and optionally provide `__dirname`/`require` shims. We’ll still update code to ESM-safe patterns to reduce reliance on shims.

3) Preload as ESM runtime
- Preload is compiled to ESM by tsup alongside main and worker (`build/main/preload.mjs`)

---

## Phase 1: Code Adjustments (ESM Safety)

Focus: path resolution and `require` usage in main-side files.

A) Replace `__dirname` patterns with `import.meta.url`
- File: src/main/main.ts (docs open path)
Current excerpt:
<code_snippet path="src/main/main.ts" mode="EXCERPT">
````ts
const docPath = path.join(__dirname, 'docs', sanitizedDocName);
const resolvedDocPath = path.resolve(docPath);
const docsDir = path.resolve(__dirname, 'docs');
````
</code_snippet>
Suggested replacement:
- At top of file:
  - import { fileURLToPath } from 'node:url';
  - const __filename = fileURLToPath(import.meta.url);
  - const __dirname = path.dirname(__filename);
- Keep the rest of the logic unchanged. This removes reliance on CJS globals.

B) Database worker path resolution and extension
- File: src/main/db/async-database.ts
Current excerpt:
<code_snippet path="src/main/db/async-database.ts" mode="EXCERPT">
````ts
this.worker = new Worker(
  path.join(__dirname, 'database-worker.ts'),
  { workerData: { dbPath: this.dbPath, ...this.options } }
);
````
</code_snippet>
Suggested replacement:
- import { fileURLToPath } from 'node:url';
- const __filename = fileURLToPath(import.meta.url);
- const __dirname = path.dirname(__filename);
- Resolve the built `.js` artifact:
  - const workerPath = path.join(__dirname, 'database-worker.mjs');
  - this.worker = new Worker(workerPath, { workerData: { ... } });
Notes:
- Ensure the worker is compiled to JS alongside this file in the same directory (tsup/tsc config will place outputs together).

C) Replace `require` usages in ESM modules
- File: src/main/db/better-sqlite3-loader.ts
Current excerpt:
<code_snippet path="src/main/db/better-sqlite3-loader.ts" mode="EXCERPT">
````ts
const mod = require('better-sqlite3') as typeof import('better-sqlite3');
...
const resolvedJs = require.resolve('better-sqlite3');
````
</code_snippet>
Suggested adjustment in ESM:
- import { createRequire } from 'node:module';
- const require = createRequire(import.meta.url);
- const mod = require('better-sqlite3') as typeof import('better-sqlite3');
- const resolvedJs = require.resolve('better-sqlite3');

- File: src/main/db/database-implementation.ts
Current excerpt:
<code_snippet path="src/main/db/database-implementation.ts" mode="EXCERPT">
````ts
return require('better-sqlite3') as BetterSqlite3Module;
````
</code_snippet>
Suggested adjustment:
- import { createRequire } from 'node:module';
- const require = createRequire(import.meta.url);
- return require('better-sqlite3') as BetterSqlite3Module;

D) Quick scan for other CJS-only patterns
- Search for `__dirname|__filename|require\(|module\.exports|exports\.` and fix similarly using `fileURLToPath` and `createRequire` where needed.

---

## Phase 2: Build and Scripts

Option A (Implemented): tsup-based ESM build for main

1) Build scripts
- package.json includes:
  - "build:main:esm": "tsup --config tsup.config.ts"
  - tsup emits ESM main and CJS preload/worker in one pass

2) Dev workflow
- dev.ts runs tsup watch and starts Electron with `build/main/main.mjs`.
- `npm run dev:electron` orchestrates Vite + tsup + Electron.

3) Packaging scripts
- `package`, `package:*`, and `release` use `build:main:esm` and package against ESM main (package.json main → main.mjs)

Option B: tsc NodeNext (alternative, more intrusive)

1) Set tsconfig.main.json to NodeNext
- compilerOptions.module: "NodeNext"
- compilerOptions.moduleResolution: "NodeNext"
- To emit `.mjs`, files should be `.mts` (renaming source files) or use a post-build rename. This is more invasive; prefer tsup.

---

## Phase 3: Validation Checklist

Blocking checks
- Static
  - grep -R "__dirname|__filename|require\(|module\.exports|exports\." src/main src/security src/shared src/services | cat
  - Ensure all runtime paths reference `.js` outputs, not `.ts`
- Build
  - npm run build (renderer)
  - npm run build:main:esm (main → ESM)
  - Confirm artifacts:
    - build/main/main.mjs present
    - build/main/preload.js (if kept CJS), or preload also emitted as `.mjs` if desired
- Dev run (trial)
  - Terminal 1: npm run dev (Vite)
  - Terminal 2: npm run build:main:esm -- --watch
  - Terminal 3: npm run start:esm
  - In-app smoke tests:
    - Select folder, file listing streams, token count appears; open docs; search functions; no console errors
- Verify build config
  - npm run verify-build
- Package (trial)
  - npm run package:esm
  - Install/run packaged app; repeat smoke tests; ensure better-sqlite3 loads (watch logs)
- Tests
  - npm test (existing jest setup should remain unaffected since repo type remains CommonJS)

---

## Phase 4: Cutover
Completed. Repo now uses ESM-only main; no CJS main compatibility maintained.

---

## Rollback Plan
Deprecated. We no longer maintain CJS main compatibility.

---

## Known Caveats and Notes
- better-sqlite3 is CJS; continue to load via `createRequire(import.meta.url)` or dynamic `import()` if you adapt types
- Do not bundle native modules; prefer tsup with `--splitting false` and default externalization
- If later flipping repo to `"type": "module"`, rename Node-loaded config files (e.g., `jest.config.js` → `jest.config.cjs`) and revisit any `.js` runtime consumers

---

## Appendix: Files touched and context

- package.json: add trial scripts; later update `main` to `.mjs`
- src/main/main.ts: add `fileURLToPath` and compute `__dirname` for ESM
- src/main/db/async-database.ts: use `.js` worker artifact and ESM-safe path derivation
- src/main/db/better-sqlite3-loader.ts, src/main/db/database-implementation.ts: use `createRequire`
- dev.ts (optional): point to `build:main:esm` and `.mjs` entry during dev

This plan keeps scope tight, avoids broad repo changes, and provides a safe trial path before cutover.
