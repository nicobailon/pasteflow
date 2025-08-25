# Build & Packaging Scripts (TypeScript)

This directory contains TypeScript utility scripts for building, packaging, and validating the Electron application. During development they run with `tsx`; for production packaging hooks, they compile to CommonJS in `build/scripts` via `npm run build:scripts`.

## How these scripts run

- Dev-time execution: `tsx` runs the `.ts` files directly (no transpile step).
- Packaging-time hooks: `npm run build:scripts` compiles `scripts/*.ts` to CJS under `build/scripts`, which are then used by electron-builder at runtime (e.g., `afterSign`).

Related config:
- Compile-to-CJS for scripts: `tsconfig.scripts.json`
- electron-builder hook in [package.json](../package.json): `"afterSign": "build/scripts/notarize.js"`

## Available Scripts

### verify-build.ts

Verifies that your `package.json` build configuration is correct for Electron builds (e.g., main entry exists, Vite output present), and prints electron‑builder version.

Usage:

```bash
npm run verify-build
```

### test-local-build.ts

Tests the complete build and packaging process for Electron locally. Useful to validate build/packaging before pushing to CI.

Usage:

```bash
# Test the build for the current platform
npm run test-build

# Test for a specific platform
npm run test-build:mac
npm run test-build:win
npm run test-build:linux
```

### build-main-ts.ts

Builds the Electron main/preload TypeScript to CommonJS in `build/main`. This is normally invoked by higher-level npm scripts, but can be called directly if needed.

Usage:

```bash
npx tsx scripts/build-main-ts.ts
```

### fix-dependencies.ts

Ensures critical native dependencies and asar unpack rules are properly configured in `package.json` (e.g., better-sqlite3, tiktoken). Use only when packaging adjustments are required.

Usage:

```bash
npx tsx scripts/fix-dependencies.ts
```

### release-checklist.ts

Runs a release readiness checklist:
- TypeScript compile check
- ESLint
- Test suite
- Build outputs present
- Optional: generate release notes

Usage:

```bash
npx tsx scripts/release-checklist.ts
# or notes
npx tsx scripts/release-checklist.ts notes
```

## Debugging GitHub Actions

If you’re having issues with GitHub Actions not building binaries correctly, use the debug workflow:

1. Create a debug tag to trigger verbose CI:
   ```bash
   npm run debug-gh-release
   ```

2. This triggers `.github/workflows/debug-build.yml` with extensive logging.

3. Check GitHub Actions logs to inspect the build steps and artifact handling.

## Troubleshooting Common Issues

### No binaries in release

If a GitHub release only contains source code and no binaries:

1. Confirm the workflow actually ran (GitHub Actions tab).
2. Verify the workflow uploads artifacts to the release.
3. Ensure electron-builder config in `package.json` is correct.
4. Run `npm run test-build` locally to reproduce.
5. Use the `debug-gh-release` script for extra logging.

### Incorrect artifact paths

If the workflow fails to find artifacts:

1. Confirm `build.directories.output` in `package.json` matches expected paths in the workflow.
2. Check electron‑builder logs to see where files are created.
3. Align the upload step with the output directory (`release-builds` by default).

## Notes on Hooks and TS

- The notarization hook at packaging time is implemented in TypeScript as `scripts/notarize.ts` but must run as CommonJS by electron‑builder. That’s why we compile scripts to `build/scripts` and point electron‑builder to `build/scripts/notarize.js`.
- Always run `npm run build:scripts` prior to packaging steps (our `package*` npm scripts already do this).

## CLI Build &amp; Usage

The repository includes a first‑party CLI for headless workflows (automation, CI). It is built from TypeScript sources under `cli/` and exposed via package bin entries in [package.json](package.json:5).

### Scripts
- Build once:
  ```bash
  npm run build:cli
  ```
  See scripts in [package.json](package.json:48-49): `build:cli`, `build:cli:watch`.

- Watch mode during development:
  ```bash
  npm run build:cli:watch
  ```

### Running the CLI (local repo)
- Direct execution from the build output:
  ```bash
  node cli/dist/index.js --help
  node cli/dist/index.js status
  ```
- Global dev link (exposes `pasteflow` and `pf` via [package.json](package.json:5-8)):
  ```bash
  npm link
  pasteflow status
  pf workspaces list
  ```

### Global flags (consistent across commands)
- `--host`, `--port`, `--token` override discovery from `~/.pasteflow/{server.port,auth.token}`.
- `--json` prints machine‑readable payloads (success or error envelopes).
- `--raw` emits raw content for files/content/preview content commands.
- `--timeout &lt;ms&gt;` HTTP timeout (default ~10s).
- `--debug` prints HTTP request/response summaries.

### Exit codes (for scripting)
- 0: success
- 1: general/server error (INTERNAL_ERROR, FILE_SYSTEM_ERROR)
- 2: validation/path denied (VALIDATION_ERROR, NO_ACTIVE_WORKSPACE)
- 3: authentication failure (UNAUTHORIZED)
- 4: not found
- 5: conflict/binary (CONFLICT, BINARY_FILE, local EEXIST)
- 6: server not running/unreachable

### Common usage examples
- Status:
  ```bash
  pasteflow status
  ```
- Workspaces:
  ```bash
  pasteflow workspaces list
  pasteflow workspaces create --name "WS" --folder "/abs/path"
  pasteflow workspaces load &lt;id&gt;
  ```
- Files (absolute paths required client‑side):
  ```bash
  pasteflow files info --path "/abs/path/file.ts"
  pasteflow files content --path "/abs/path/file.ts" --out out.txt --overwrite
  ```
- Selection:
  ```bash
  pasteflow select add --path "/abs/path/file.ts" --lines "10-20,30"
  pasteflow select list
  ```
- Content aggregation:
  ```bash
  pasteflow content get --max-files 500 --max-bytes 2000000 --out pack.txt --overwrite
  pasteflow content export --out "/abs/path/pack.txt" --overwrite
  ```
- Preview (async):
  ```bash
  pasteflow preview start --prompt @prompt.txt --follow --out preview.md --overwrite
  pasteflow preview status &lt;id&gt; --watch
  pasteflow preview content &lt;id&gt; --raw
  pasteflow preview cancel &lt;id&gt;
  ```

### Troubleshooting
- Server unreachable (exit 6): Start the app so the local HTTP API is running and port/token are available:
  ```bash
  npm run dev:electron
  ```
- NO_ACTIVE_WORKSPACE (exit 2): Initialize one:
  ```bash
  pasteflow folders open --folder "/your/repo"
  # or
  pasteflow workspaces load &lt;id&gt;
  ```

### Sources
- CLI entry: [cli/src/index.ts](cli/src/index.ts:1)
- HTTP client &amp; discovery: [cli/src/client.ts](cli/src/client.ts:1)
- Commands: [cli/src/commands/](cli/src/commands/status.ts:1) (see sibling files for each command group)
