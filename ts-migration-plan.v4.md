# PasteFlow Electron — TypeScript Migration Plan

A production-safe, executable blueprint to migrate PasteFlow to a single-source TypeScript codebase for both Electron main and renderer. The plan removes legacy JS/CJS aggressively and avoids feature flags or maintaining legacy compatibility. It proceeds in small, mergeable PRs with explicit validation gates and rollback steps. npm is assumed; notes for yarn/pnpm are included where helpful.

Key repository files referenced:
- [all-changes.md](all-changes.md)
- [package.json](package.json)
- [package-lock.json](package-lock.json)
- [dev.js](dev.js)
- [jest.config.js](jest.config.js)
- [vite.config.ts](vite.config.ts)
- [tsconfig.json](tsconfig.json)
- [tsconfig.main.json](tsconfig.main.json)
- [main.js](main.js)
- [preload.js](preload.js)
- [lib/main/ipc/schemas.cjs](lib/main/ipc/schemas.cjs)
- [scripts/build-schemas.js](scripts/build-schemas.js)
- [src/constants/app-constants.ts](src/constants/app-constants.ts)
- [src/constants/index.ts](src/constants/index.ts)
- [src/shared/excluded-files.ts](src/shared/excluded-files.ts)
- [src/utils/ignore-utils.ts](src/utils/ignore-utils.ts)
- [src/security/path-validator.ts](src/security/path-validator.ts)
- [src/types/electron-api.d.ts](src/types/electron-api.d.ts)
- [src/main/preload.ts](src/main/preload.ts)
- [src/main/main.ts](src/main/main.ts)

Phased, incremental migration strategy

This plan removes legacy JS/CJS aggressively while preserving service availability during the transition. Each phase is a small, mergeable PR with strict validation gates and rollback steps. No feature flags. No dual paths beyond the PR that converts and deletes.

Phase 0 — Enablement and dev fixes (no behavior change)
Goal: Align TypeScript compiler configs and tooling, fix the dev-time double-build bug, and make aliasing consistent.

1) Install dev dependencies (npm; for yarn: add -D; for pnpm: add -D)
```shell
npm install --save-dev \
  typescript@5.3.3 \
  tsc-alias@1.8.16 \
  vite-tsconfig-paths@4.3.2 \
  @typescript-eslint/parser@7.18.0 \
  @typescript-eslint/eslint-plugin@7.18.0 \
  eslint-import-resolver-typescript@3.6.1 \
  ts-jest@29.1.2 \
  @types/node@20 \
  @types/electron@25
```

2) Add base tsconfig (new file)
- tsconfig.base.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "moduleResolution": "Node",
    "baseUrl": ".",
    "paths": {
      "@constants": ["src/constants/index.ts"],
      "@constants/*": ["src/constants/*"],
      "@shared/*": ["src/shared/*"]
    },

    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": false,
    "sourceMap": true,
    "incremental": true
  }
}
```

3) Renderer tsconfig extends base; bundler mode stays in renderer only
- tsconfig.json (unified diff)
```diff
--- a/tsconfig.json
+++ b/tsconfig.json
@@
+{
+  "extends": "./tsconfig.base.json",
   "compilerOptions": {
     "target": "ES2020",
-    "useDefineForClassFields": true,
     "lib": ["ES2020", "DOM", "DOM.Iterable"],
     "module": "ESNext",
-    "skipLibCheck": true,
-
-    /* Bundler mode */
+    "jsx": "react-jsx",
     "moduleResolution": "bundler",
     "allowImportingTsExtensions": true,
-    "resolveJsonModule": true,
     "isolatedModules": true,
     "noEmit": true,
-    "jsx": "react-jsx",
-
+    "skipLibCheck": true,
+    "types": ["vite/client"],
+    "jsxImportSource": "react",
+    "checkJs": false,
+    "allowSyntheticDefaultImports": true,
+    "useDefineForClassFields": true
   },
-  "include": ["src", "src/declarations.d.ts", "src/types"],
-  "references": [{ "path": "./tsconfig.node.json" }]
-}
+  "include": [
+    "src/**/*.ts",
+    "src/**/*.tsx",
+    "src/types/**/*.d.ts",
+    "src/declarations.d.ts"
+  ],
+  "exclude": [
+    "src/main/**",
+    "src/**/__tests__/**",
+    "src/**/__mocks__/**"
+  ],
+  "references": [{ "path": "./tsconfig.node.json" }]
+}
```

4) Main tsconfig extends base; compile to CJS into build/
- tsconfig.main.json (unified diff)
```diff
--- a/tsconfig.main.json
+++ b/tsconfig.main.json
@@
-{
-  // Separate config for main-layer CJS build; do not extend app tsconfig to avoid noEmit settings
-
-  "compilerOptions": {
+{
+  "extends": "./tsconfig.base.json",
+  "compilerOptions": {
     "module": "CommonJS",
     "target": "ES2020",
-    "outDir": "build/main",
-    "rootDir": "src/main",
-    "noEmit": false,
     "moduleResolution": "Node",
-    "allowImportingTsExtensions": false,
-    "esModuleInterop": true,
+    "outDir": "build",
+    "rootDir": "src",
+    "noEmit": false,
+    "sourceMap": true,
     "skipLibCheck": true,
-    "declaration": false,
-    "sourceMap": false,
+    "esModuleInterop": true,
     "resolveJsonModule": true,
-    "isolatedModules": false,
-    "lib": ["ES2020", "DOM"],
-    "types": []
+    "types": ["node", "electron"],
+    "lib": ["ES2020"]
   },
   "include": [
-    "src/main/ipc/schemas.ts",
-    "src/main/db/async-database.ts",
-    "src/main/db/connection-pool.ts", 
-    "src/main/db/pool-config.ts",
-    "src/main/db/pooled-database.ts",
-    "src/main/db/pooled-database-bridge.ts",
-    "src/main/db/retry-utils.ts",
-    "src/main/db/shared-buffer-utils.ts",
-    "src/main/db/database-implementation.ts",
-    "src/main/db/database-bridge.ts",
-    "src/main/db/database-worker.ts"
+    "src/main/**/*.ts",
+    "src/security/**/*.ts",
+    "src/validation/**/*.ts",
+    "src/constants/**/*.ts",
+    "src/shared/**/*.ts",
+    "src/types/**/*.d.ts"
   ],
   "exclude": [
-    "src/main/db/__tests__/**"
+    "src/**/__tests__/**",
+    "src/**/__mocks__/**"
   ]
-}
+}
```

5) Make Vite read aliases from tsconfig (remove manual alias duplication)
- vite.config.ts (unified diff)
```diff
--- a/vite.config.ts
+++ b/vite.config.ts
@@
-import path from 'path';
+import tsconfigPaths from 'vite-tsconfig-paths';
 
 export default defineConfig({
   plugins: [
     react(),
     wasm(),
     topLevelAwait(),
+    tsconfigPaths()
   ],
   resolve: {
     extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
-    preferRelative: true,
-    alias: {
-      '@constants': path.resolve(__dirname, './src/constants'),
-      '@shared': path.resolve(__dirname, './src/shared')
-    }
+    preferRelative: true
   },
   worker: {
     format: 'es',
```

6) Ensure Jest maps aliases and transforms TS
- jest.config.js (unified diff)
```diff
--- a/jest.config.js
+++ b/jest.config.js
@@
   moduleNameMapper: {
+    '^@constants$': '<rootDir>/src/constants/index.ts',
+    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
+    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
     '\\.(css|scss)$': '<rootDir>/src/__tests__/__mocks__/styleMock.js',
     '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/src/__tests__/__mocks__/fileMock.js'
   },
+  transform: {
+    '^.+\\.(ts|tsx)$': 'ts-jest'
+  },
   testEnvironment: 'jsdom',
   setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
 }
```

7) Fix double-build: rely on dev.js to build; keep "start" lean
- package.json (unified diff)
```diff
--- a/package.json
+++ b/package.json
@@
-  "main": "build/main/main.js",
+  "main": "build/main/main.js",
   "scripts": {
-    "start": "npm run build:main && electron .",
+    "start": "electron .",
     "build:main": "tsc -p tsconfig.main.json && tsc-alias -p tsconfig.main.json",
     "build:main:watch": "tsc -p tsconfig.main.json --watch & tsc-alias -p tsconfig.main.json --watch",
     "dev": "vite",
     "dev:electron": "node dev.js",
     "build": "vite build",
```

Validation gate — Phase 0
- npm run typecheck: 0 errors.
- Vite dev runs with tsconfig-sourced aliases.
- Jest resolves @constants/@shared and runs.
- Starting electron via dev.js no longer double-builds.

Phase 1 — Constants barrel and import normalization
Goal: Provide a single import surface for constants and ensure all imports use @constants. No legacy alias paths remain.

1) Add constants barrel
- src/constants/index.ts
```ts
export * from './app-constants';
export * from './workspace-drag-constants';

export const STORAGE_KEYS = {
  SELECTED_FOLDER: 'pasteflow.selected_folder',
  SELECTED_FILES: 'pasteflow.selected_files',
  SORT_ORDER: 'pasteflow.sort_order',
  FILE_TREE_SORT_ORDER: 'pasteflow.file_tree_sort_order',
  SEARCH_TERM: 'pasteflow.search_term',
  FILE_TREE_MODE: 'pasteflow.file_tree_mode',
  SYSTEM_PROMPTS: 'pasteflow.system_prompts',
  ROLE_PROMPTS: 'pasteflow.role_prompts',
  DOCS: 'pasteflow.docs',
  WORKSPACES: 'pasteflow.workspaces',
  CURRENT_WORKSPACE: 'pasteflow.current_workspace',
  WORKSPACE_SORT_MODE: 'pasteflow.workspace_sort_mode',
  WORKSPACE_MANUAL_ORDER: 'pasteflow.workspace_manual_order'
} as const;
```

2) Replace imports
- Update imports like `../constants` or `../constants/app-constants` to `@constants` or `@constants/app-constants`. Representative (already largely done in diffs):
```diff
--- a/src/__tests__/app-state-workspace-test.ts
+++ b/src/__tests__/app-state-workspace-test.ts
- import { STORAGE_KEYS } from '../constants';
+ import { STORAGE_KEYS } from '@constants';
```

Validation gate — Phase 1
- typecheck: 0 errors.
- No import from bare '../constants' remains (enforce with ESLint import rules if desired).

Phase 2 — Shared excluded-files module and removal of legacy duplicates
Goal: Use a single TS source for shared exclusion patterns, update imports, then delete legacy files.

1) Add shared module (if not present)
- src/shared/excluded-files.ts
```ts
export const excludedFiles: string[] = [
  "package-lock.json","yarn.lock","npm-debug.log*","yarn-debug.log*","yarn-error.log*",
  "pnpm-lock.yaml",".npmrc",".yarnrc",".nvmrc","node_modules/**",
  ".eslintrc*",".prettierrc*","tsconfig*.json","*.d.ts","*.min.js","*.map",
  "__pycache__/**","*.pyc","*.pyo","*.pyd",".pytest_cache/**",".coverage",".python-version",
  "venv/**",".venv/**","*.egg-info/**","pip-log.txt","pip-delete-this-directory.txt",
  "go.sum","go.mod","vendor/**",
  "*.class","*.jar","target/**",".gradle/**",
  "Gemfile.lock",".bundle/**",
  "composer.lock","vendor/**",
  "Cargo.lock","target/**",
  "bin/**","obj/**","*.suo","*.user",
  "*.jpg","*.jpeg","*.png","*.gif","*.ico","*.webp","*.svg","*.pdf","*.zip","*.tar.gz","*.tgz","*.rar",
  ".idea/**",".vscode/**","*.swp","*.swo",".DS_Store",
  "dist/**","build/**","out/**",".next/**",
  "logs/**","*.log",
  "*.sqlite","*.db",
  ".env*",".aws/**","*.pem","*.key",
  "docker-compose.override.yml",
  ".git/**",".github/**",".gitlab/**"
];

export const binaryExtensions: string[] = [
  ".svg",".jpg",".jpeg",".png",".gif",".bmp",".tiff",".ico",".webp",
  ".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx"
];
```

2) Ensure import redirects (already reflected)
```diff
--- a/src/utils/ignore-utils.ts
+++ b/src/utils/ignore-utils.ts
- import { excludedFiles } from '../../excluded-files';
+ import { excludedFiles } from '@shared/excluded-files';
```

3) Delete legacy duplicates after green build/tests
- Remove [excluded-files.js](excluded-files.js) and any top-level [excluded-files.ts](excluded-files.ts) remnants.

Validation gate — Phase 2
- typecheck: 0 errors.
- file filtering functions and tests pass.

Phase 3 — Typed preload and global electron typing
Goal: Add typed preload and ambient types to the renderer. Keep runtime preload path unchanged until compiled preload exists under build/main.

1) Ambient global typing for window.electron
- src/types/electron-api.d.ts
```ts
export {};

declare global {
  interface Window {
    electron: {
      send: (channel: string, data?: unknown) => void;
      receive: (channel: string, fn: (...args: unknown[]) => void) => void;
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => void;
        on: (channel: string, fn: (...args: unknown[]) => void) => void;
        removeListener: (channel: string, fn: (...args: unknown[]) => void) => void;
        invoke: (channel: string, data?: unknown) => Promise<unknown>;
      };
    };
  }
}
```

2) Add typed preload
- src/main/preload.ts
```ts
import { contextBridge, ipcRenderer } from 'electron';

function ensureSerializable(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(ensureSerializable);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'function' || typeof v === 'symbol') continue;
    result[k] = ensureSerializable(v);
  }
  return result;
}

const __ipcListenerWrappers = new Map<string, WeakMap<(...a: any[]) => void, (...a: any[]) => void>>();
const __appWillQuitSubscribers = new Set<() => void>();
let __appWillQuitRegistered = false;

const __appWillQuitHandler = () => {
  for (const cb of Array.from(__appWillQuitSubscribers)) {
    try { cb(); } catch (err) { console.error('Error in app-will-quit subscriber:', err); }
  }
};

function addAppWillQuitListener(cb: () => void) {
  if (!__appWillQuitRegistered) {
    ipcRenderer.on('app-will-quit', __appWillQuitHandler);
    __appWillQuitRegistered = true;
  }
  __appWillQuitSubscribers.add(cb);
  return cb;
}

function removeAppWillQuitListener(cb: () => void) {
  __appWillQuitSubscribers.delete(cb);
  if (__appWillQuitRegistered && __appWillQuitSubscribers.size === 0) {
    try { ipcRenderer.removeListener('app-will-quit', __appWillQuitHandler); } catch {}
    __appWillQuitRegistered = false;
  }
}

if (process.env.NODE_ENV === 'development') {
  ipcRenderer.setMaxListeners(100);
}

contextBridge.exposeInMainWorld('electron', {
  send: (channel: string, data?: unknown) => {
    const valid = ["open-folder","request-file-list","apply-changes","cancel-file-loading","app-will-quit-save-complete"];
    if (valid.includes(channel)) ipcRenderer.send(channel, ensureSerializable(data));
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const valid = ["folder-selected","file-list-data","file-processing-status","apply-changes-response"];
    if (!valid.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => func(...args.map(ensureSerializable)));
  },
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args.map(ensureSerializable)),
    on: (channel: string, func: (...args: unknown[]) => void) => {
      if (channel === 'app-will-quit') return addAppWillQuitListener(func as () => void);
      const wrapper = (_e: unknown, ...args: unknown[]) => {
        try { func(...args.map(ensureSerializable)); } catch (e) { console.error(`IPC handler error for ${channel}:`, e); }
      };
      ipcRenderer.on(channel, wrapper);
      let mapForChannel = __ipcListenerWrappers.get(channel);
      if (!mapForChannel) {
        mapForChannel = new WeakMap();
        __ipcListenerWrappers.set(channel, mapForChannel);
      }
      mapForChannel.set(func, wrapper);
      return wrapper;
    },
    removeListener: (channel: string, func: (...args: unknown[]) => void) => {
      if (channel === 'app-will-quit') return removeAppWillQuitListener(func as () => void);
      const mapForChannel = __ipcListenerWrappers.get(channel);
      const maybeWrapper = mapForChannel?.get(func);
      if (maybeWrapper) {
        ipcRenderer.removeListener(channel, maybeWrapper);
        mapForChannel?.delete(func);
      } else {
        ipcRenderer.removeListener(channel, func);
      }
    },
    invoke: async (channel: string, data?: unknown): Promise<unknown> => {
      const payload = ensureSerializable(data);
      const result = await ipcRenderer.invoke(channel, payload);
      return ensureSerializable(result);
    }
  }
});
```

Validation gate — Phase 3
- typecheck: 0 errors; renderer recognizes window.electron.
- Preload path remains pointing to preload.js while we haven’t switched package.json entry; no runtime changes yet.

Phase 4 — TypeScript Electron main (CJS) and IPC envelope standardization
Goal: Port main to TS, compile to build/main/main.js, and standardize all IPC responses to a { success, data } / { success, error } envelope. Update renderer to remove fallback logic and accept only the envelope.

1) Create main.ts with CJS output and preload path
- src/main/main.ts (structure guidance)
```ts
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { getPathValidator } from '../security/path-validator';
import * as zSchemas from './ipc/schemas';
import { excludedFiles, binaryExtensions } from '@shared/excluded-files';
import { FILE_PROCESSING, ELECTRON, TOKEN_COUNTING } from '@constants/app-constants';

process.env.ZOD_DISABLE_DOC = process.env.ZOD_DISABLE_DOC || '1';

// Create BrowserWindow, set CSP, load Vite URL in dev and file:// in prod.
// Important: preload should point to compiled co-located preload.js under build/main
// preload: path.join(__dirname, 'preload.js')

// Implement IPC handlers and return { success, data } envelopes uniformly.
```

2) Standardize all IpcMainHandle results to envelopes (representative examples)
- Workspace list
```ts
ipcMain.handle('/workspace/list', async () => {
  try {
    if (database && database.initialized) {
      const workspaces = await database.listWorkspaces();
      return { success: true, data: workspaces.map(w => ({ ...w, id: String(w.id) })) };
    }
    const workspaces = Array.from(workspaceStore.entries())
      .sort((a, b) => (b[1].lastAccessed || 0) - (a[1].lastAccessed || 0))
      .map(([name, data]) => ({
        id: name, name, folderPath: data.folderPath || '', state: data.state || {},
        createdAt: data.createdAt || Date.now(), updatedAt: data.updatedAt || Date.now(),
        lastAccessed: data.lastAccessed || Date.now()
      }));
    return { success: true, data: workspaces };
  } catch (error: any) {
    return { success: false, error: String(error?.message || error) };
  }
});
```
- Preferences get (return nullable value in data)
```ts
ipcMain.handle('/prefs/get', async (_e, params) => {
  try {
    const key = typeof params === 'string' ? params : params?.key;
    if (!key || typeof key !== 'string') return { success: false, error: 'Invalid key' };
    if (database && database.initialized) {
      const value = await database.getPreference(key);
      return { success: true, data: value ?? null };
    }
    const value = preferencesStore.get(key);
    return { success: true, data: value ?? null };
  } catch (error: any) {
    return { success: false, error: String(error?.message || error) };
  }
});
```
- File content (enforce envelope even on errors)
```ts
ipcMain.handle('request-file-content', async (_e, filePath: string) => {
  try {
    zSchemas.RequestFileContentSchema.parse({ filePath });
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) };
  }
  if (!currentWorkspacePaths?.length) {
    return { success: false, error: 'No workspace selected', reason: 'NO_WORKSPACE' };
  }
  const v = getPathValidator(currentWorkspacePaths).validatePath(filePath);
  if (!v.valid) return { success: false, error: 'Access denied', reason: v.reason };
  if (isBinaryFile(filePath) || isSpecialFile(filePath)) return { success: false, error: 'File contains binary data', isBinary: true };
  try {
    const content = await fs.promises.readFile(v.sanitizedPath!, 'utf8');
    if (isLikelyBinaryContent(content, filePath)) return { success: false, error: 'File contains binary data', isBinary: true };
    const tokenCount = countTokens(content);
    return { success: true, data: { content, tokenCount } };
  } catch (error: any) {
    const extIsBinary = isBinaryFile(filePath) || isSpecialFile(filePath);
    return { success: false, error: String(error?.message || error), isBinary: extIsBinary };
  }
});
```

3) Update renderer to expect the envelope exclusively (remove fallback)
- src/hooks/use-database-state.ts (representative unified diff)
```diff
--- a/src/hooks/use-database-state.ts
+++ b/src/hooks/use-database-state.ts
@@
-      const response = await window.electron.ipcRenderer.invoke(channel, params || {});
-      // Handle both raw data and { success, data } format
-      const result = response?.success !== undefined ? response.data : response;
+      const response = await window.electron.ipcRenderer.invoke(channel, params || {});
+      if (!response || response.success !== true) {
+        throw new Error((response && response.error) || 'IPC request failed');
+      }
+      const result = response.data;
@@
-      const response = await window.electron.ipcRenderer.invoke(updateChannel, params);
-      // Handle both raw data and { success, data } format
-      const result = response?.success !== undefined ? response.data : response;
+      const response = await window.electron.ipcRenderer.invoke(updateChannel, params);
+      if (!response || response.success !== true) {
+        throw new Error((response && response.error) || 'IPC update failed');
+      }
+      const result = response.data;
```
- Apply similar strict envelope expectations in:
  - [src/hooks/use-database-workspace-state.ts](src/hooks/use-database-workspace-state.ts)
  - [src/utils/workspace-cache-manager.ts](src/utils/workspace-cache-manager.ts)
  - [src/utils/workspace-sorting.ts](src/utils/workspace-sorting.ts)
  - Any other renderer IPC call sites.

4) Build main and rewrite aliases
```shell
npm run build:main
```

5) Manual boot from compiled entry (without flipping package.json "main" yet)
```shell
ELECTRON_DISABLE_SECURITY_WARNINGS=1 ./node_modules/.bin/electron ./build/main/main.js
```
Verify window opens, folder selection works, files scan, and previews load.

Validation gate — Phase 4
- typecheck: 0 errors.
- Manual boot from compiled main: green.
- IPC calls function with the envelope; renderer updated accordingly.

Phase 5 — Switch package.json main, update packaging, remove generator/artifacts and JS duplicates
Goal: After main and preload are compiled and verified, flip the Electron entry, adjust builder files, and delete legacy artifacts aggressively.

1) Switch entry; package only dist/build
- package.json (unified diff)
```diff
--- a/package.json
+++ b/package.json
@@
-  "main": "main.js",
+  "main": "build/main/main.js",
@@
   "files": [
-    "dist/**/*",
-    "main.js",
-    "preload.js",
-    "excluded-files.js",
-    "node_modules/**/*"
+    "dist/**/*",
+    "build/**/*",
+    "node_modules/**/*"
   ],
```

2) Ensure dev.js continues to build main (no duplicate builds in "start" per Phase 0)

3) Delete schema generator and artifact
- Remove [lib/main/ipc/schemas.cjs](lib/main/ipc/schemas.cjs) and [scripts/build-schemas.js](scripts/build-schemas.js).

4) Remove legacy JS/CJS duplicates
- Delete [main.js](main.js) and [preload.js](preload.js).
- Confirm no references remain to removed files.

Validation gate — Phase 5
- typecheck: 0 errors.
- All tests green; coverage thresholds met or improved.
- Local dev (vite + dev.js) green; packaging ("package" scripts) green.

Phase 6 — Strictness ratchet and cleanup
Goal: Raise type-safety, remove transitional code/comments, and ensure no ts-ignore remains.

1) Ratchet flags in tsconfig.base.json
```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true
  }
}
```

2) Evaluate "isolatedModules" in main
- Try enabling in tsconfig.main.json; resolve remaining issues if any. Renderer remains "bundler" with isolated modules via Vite pipeline.

3) Remove any "@ts-ignore"/"@ts-nocheck" by replacing with proper types or .d.ts shims.

4) Confirm no '@constants' and '@shared' alias strings remain in emitted JS (tsc-alias validates rewrite).

Validation gate — Phase 6
- typecheck: 0 errors.
- lint:strict: no warnings.
- Tests: green; coverage maintained or improved.

----------------------------------------------------------------

Mixed JS/TS interop and ESM/CJS compatibility guidance

- Convert require to import with esModuleInterop:
```ts
// Before
const path = require('node:path');
// After
import path from 'node:path';
```

- Generate .d.ts shims for untyped modules when necessary:
```ts
// src/types/shims.d.ts
declare module 'untyped-lib';
```

- JSON imports enabled via resolveJsonModule:
```ts
import data from './data.json';
```

- Keep DOM libs out of main (tsconfig main libs: ["ES2020"] only).

- Ambient globals: only in src/types (e.g., electron-api.d.ts), not in implementation files.

- Break cycles by extracting types to src/types and constants to src/constants; refer downwards (from features -> constants/types), not sideways between features.

----------------------------------------------------------------

Repository setup and tooling

ESLint (type-aware) config (snippet additions)
- .eslintrc.cjs
```js
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['tsconfig.json','tsconfig.main.json','tsconfig.base.json']
      }
    }
  },
  overrides: [
    {
      files: ['*.ts','*.tsx'],
      extends: ['plugin:@typescript-eslint/recommended','plugin:import/typescript'],
      rules: {
        '@typescript-eslint/consistent-type-imports': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn',{ argsIgnorePattern: '^_' }]
      }
    }
  ]
};
```

Prettier basic configuration (if missing)
- .prettierrc
```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Testing with ts-jest transform (already in Phase 0 diff). Set realistic coverage thresholds (or keep current).
```json
{
  "jest": {
    "coverageThreshold": {
      "global": {
        "branches": 70,
        "functions": 80,
        "lines": 85,
        "statements": 85
      }
    }
  }
}
```

Build/bundler stack
- Renderer: Vite + vite-tsconfig-paths; HMR preserved.
- Main: tsc -> build (CJS) + tsc-alias rewrite.

Local development
- No runtime tsx in main.
- Dev: run `npm run build:main:watch` + `vite` and launch electron via dev.js.

CI pipeline (GitHub Actions example)
```yaml
name: ci
on:
  push: { branches: [ main ] }
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint:strict
      - run: npm test -- --ci
      - run: npm run build
      - run: npm run build:main
```

----------------------------------------------------------------

PR sequence with explicit scope, diffs, gates

PR 1: Enablement + dev double-build fix
- Title: chore(ts): add tsconfig base, align aliases, fix dev double-build
- Scope:
  - Add tsconfig.base.json
  - Update tsconfig.json and tsconfig.main.json to extend base
  - Switch Vite to vite-tsconfig-paths (remove manual alias block)
  - Add ts-jest transform; mirror alias mapping in jest
  - package.json: set "start": "electron ."
- Gates: typecheck 0, jest green, vite dev OK, dev.js path verified.

PR 2: Constants barrel + import normalization
- Title: refactor(constants): add barrel and migrate imports to @constants
- Scope: add src/constants/index.ts and update imports.
- Gates: typecheck 0; tests green.

PR 3: Shared excluded-files module + delete legacy files
- Title: refactor(shared): add @shared/excluded-files; remove top-level duplicates
- Scope: add src/shared/excluded-files.ts, update imports, delete excluded-files.* legacy.
- Gates: typecheck 0; tests green.

PR 4: Typed preload + global electron typing
- Title: feat(preload): add typed preload.ts and window.electron types
- Scope: add src/main/preload.ts and src/types/electron-api.d.ts (no runtime flip yet).
- Gates: typecheck 0; tests green.

PR 5: TS Electron main (CJS) + IPC envelope standardization (no entry flip)
- Title: feat(main): implement main.ts (CJS emit) and standardize IPC envelopes
- Scope: add src/main/main.ts; make all IpcMainHandle return { success, data } or { success, error }; update renderer IPC callers to expect envelopes only; build:main; manual boot from build/main/main.js.
- Gates: typecheck 0; tests green; manual boot OK.

PR 6: Switch package.json main; remove schema generator/artifact; delete legacy JS
- Title: chore(build): switch to compiled TS entry, remove schema generator & JS entries
- Scope: set "main": "build/main/main.js"; package files include "build/**/*"; delete lib/main/ipc/schemas.cjs and scripts/build-schemas.js; delete main.js, preload.js.
- Gates: typecheck 0; tests green; packaged build/boot OK.

PR 7: Strictness ratchet + cleanup
- Title: chore(ts): enable stricter flags; remove ts-ignore
- Scope: enable noUncheckedIndexedAccess, noPropertyAccessFromIndexSignature, exactOptionalPropertyTypes, useUnknownInCatchVariables; remove ts-ignore; optional: enable isolatedModules in main and fix issues.
- Gates: typecheck 0; tests green; coverage at/above baseline; lint:strict no warnings.

----------------------------------------------------------------

Acceptance criteria and measurable success metrics

Per-PR gates (strict)
- typecheck: 0 errors for every PR.
- tests: green; coverage ≥ baseline thresholds.
- Build: renderer build, main build: green.
- For PRs affecting runtime: local boot (dev and packaged) succeeds; core flows (folder selection, scan, load, preview) verified.

Global metrics
- Error budget: no increase post-release (monitor crash/error logs).
- Startup time: within ±10% of baseline or improved.
- Renderer bundle size: within ±10% of baseline or improved.

----------------------------------------------------------------

Rollback plan (fast, code-only)

If a PR causes regressions:
1) Revert the PR merge commit
```shell
git revert -m 1 <merge_commit_sha> --no-edit
git push origin HEAD
```
2) If entry flip caused breakage, restore prior package.json and reintroduce removed artifacts
```shell
git checkout HEAD~1 -- package.json
git restore --source=HEAD~1 main.js preload.js lib/main/ipc/schemas.cjs scripts/build-schemas.js
git commit -m "Rollback entry switch and restore JS artifacts"
git push
```
3) If stricter flags caused breakage, restore previous tsconfig files:
```shell
git checkout HEAD~1 -- tsconfig.base.json tsconfig.main.json
git commit -m "Rollback strict tsconfig flags"
git push
```
No feature flags involved; rollback is pure code/config reversion.

----------------------------------------------------------------

Troubleshooting (mapped to observed issues)

- Electron dev start slow; CPU spike building twice
  - Cause: dev.js and "start" both building main.
  - Fix: keep build in dev.js; set "start": "electron .".

- Module not found: @constants / @shared in Jest or dev server
  - Cause: alias inconsistency.
  - Fix: tsconfig.base.json paths; vite-tsconfig-paths; jest moduleNameMapper; remove manual Vite alias duplication.

- window.electron undefined
  - Cause: preload removed without TS replacement.
  - Fix: add src/main/preload.ts, build main; ensure preload path uses path.join(__dirname,'preload.js') in compiled main.

- Missing zod schemas after artifact removal
  - Cause: removed lib/main/ipc/schemas.cjs before shifting to TS import.
  - Fix: import './ipc/schemas' from main.ts and compile; only then delete generator/artifact.

- Renderer IPC calls sometimes work, sometimes error shape unexpected
  - Cause: mixed response shapes.
  - Fix: enforce { success, data|error } in main and require envelope in renderer (no fallbacks).

- Alias strings appear in emitted CJS
  - Cause: tsc-alias not executed after tsc.
  - Fix: tsc-alias -p tsconfig.main.json after build (and in watch).

----------------------------------------------------------------

Appendix — Quick-reference tsconfig flags

- baseUrl: "."
- paths: {"@constants": ["src/constants/index.ts"], "@constants/*": ["src/constants/*"], "@shared/*": ["src/shared/*"]}
- strict: true
- noImplicitAny: true
- noUncheckedIndexedAccess: true (Phase 6)
- noPropertyAccessFromIndexSignature: true (Phase 6)
- exactOptionalPropertyTypes: true (Phase 6)
- useUnknownInCatchVariables: true (Phase 6)
- isolatedModules: renderer via bundler; consider enabling for main in Phase 6
- esModuleInterop: true
- moduleResolution: "Node" (main), "bundler" (renderer)
- resolveJsonModule: true
- skipLibCheck: true
- allowJs: false
- checkJs: false

----------------------------------------------------------------

This plan is comprehensive and self-contained. Apply each phase in order, merging one PR at a time after its validation gate is met. The strategy aggressively removes legacy JS/CJS immediately after TS replacements are validated, avoids feature flags or compatibility shims, standardizes IPC responses, and keeps alias resolution consistent across all tooling.