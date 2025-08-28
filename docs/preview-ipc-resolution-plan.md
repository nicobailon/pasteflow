# PasteFlow Preview IPC: Analysis and Resolution Plan

## Summary
- CLI → Main works: API server creates preview jobs and broadcasts `cli-pack-start`/`cli-pack-cancel` to renderer windows.
- Renderer is missing the corresponding listeners and does not forward progress/content back to Main.
- UI does not reflect CLI-triggered pack/preview because no bridging exists between these IPC events and the renderer’s packing workflow.

## Current Architecture (Key References)
- Main broadcasts to renderer:
  - `src/main/preview-proxy.ts:48`: `win.webContents.send('cli-pack-start', { id, options })`
  - `src/main/preview-proxy.ts:59`: `win.webContents.send('cli-pack-cancel', { id })`
- Main expects renderer → main events:
  - `src/main/preview-proxy.ts:30`: `ipcMain.on('cli-pack-status', ...)`
  - `src/main/preview-proxy.ts:37`: `ipcMain.on('cli-pack-content', ...)`
- Preview job lifecycle in main:
  - `src/main/preview-controller.ts:34`: in‑memory jobs; subscribes to proxy `status`/`content` events.
  - `src/main/api-server.ts:129`: REST endpoints for `preview/start|status|content|cancel` delegate to controller.
- Renderer preload capabilities:
  - `src/main/preload.ts:66`: `window.electron.ipcRenderer.on/send/invoke` available (no channel whitelist on the `ipcRenderer.*` namespace).
- Renderer packing implementation:
  - `src/hooks/use-preview-generator.ts`: worker streaming + progress/content lifecycle.
  - `src/hooks/use-preview-pack.ts`: background “Pack → Preview/Copy” workflow built on `usePreviewGenerator`.
  - `src/components/content-area.tsx`: integrates `usePreviewPack` for UI.

## Gaps Identified
1. Missing renderer listeners for `cli-pack-start`/`cli-pack-cancel`.
   - No `ipcRenderer.on('cli-pack-start'| 'cli-pack-cancel')` in renderer.
   - `src/handlers/electron-handlers.ts` and `src/index.tsx` don’t handle these channels.

2. No renderer→main forwarding of preview progress/content for CLI jobs.
   - Main is listening for `cli-pack-status` and `cli-pack-content`, but renderer never emits them.

3. Auto-pack not triggered by CLI.
   - CLI expects the UI to “pack” even if the user hasn’t manually done so; renderer never starts the pack pipeline when `cli-pack-start` arrives.

4. Bidirectional UI sync is absent.
   - CLI-driven operations don’t update UI because the pack pipeline is never invoked from the renderer side.

5. Option handling
   - `preview start` includes options (`includeTrees`, `maxFiles`, `maxBytes`, `prompt`) not currently mapped into the renderer pack invocation.

## Constraints and Considerations
- Preload channel access: use `window.electron.ipcRenderer.*` for both listening and sending custom channels (no additional whitelist needed).
- Single-window assumption: `BrowserWindow.getAllWindows()` broadcasts to all, but app typically runs a single window.
- Worker concurrency: `usePreviewPack` spawns a worker; we must avoid duplicating workers or competing pack processes in one renderer.
- State source of truth: UI should be in sync with CLI pack; best path is to reuse the existing `usePreviewPack` pipeline to keep the UI updated.

---

## Plan A — Implement Missing Handlers (Renderer)

Goal: Hook renderer to respond to `cli-pack-start`/`cli-pack-cancel`, start/cancel packing, and forward status/content to main.

1) Add a lightweight bridge component in the renderer
- File: `src/components/cli-pack-bridge.tsx` (new)
- Responsibilities:
  - Register IPC listeners:
    - `ipcRenderer.on('cli-pack-start', (evt, { id, options }) => ...)`
    - `ipcRenderer.on('cli-pack-cancel', (evt, { id }) => ...)`
  - Invoke the existing pack pipeline from UI context (see Integration below).
  - Maintain the current CLI job id in a ref.
  - Forward updates to main:
    - On first progress or start: `ipcRenderer.send('cli-pack-status', { id, state: 'RUNNING', progress })`.
    - On error: `ipcRenderer.send('cli-pack-status', { id, state: 'FAILED', message })`.
    - On cancel: `ipcRenderer.send('cli-pack-status', { id, state: 'CANCELLED' })`.
    - On success: `ipcRenderer.send('cli-pack-content', { id, content, fileCount })`.
  - Option mapping (initial):
    - `prompt`: if present, temporarily override user instructions for this pack session only (see Plan B below for safe override mechanics).
    - `includeTrees`: map to file tree mode override (see Plan B changes for `usePreviewPack`).
    - `maxFiles`/`maxBytes`: not directly used by worker; consider using them to cap inputs before starting (see Plan B enhancements).

2) Mount the bridge at app root
- File: `src/main.tsx`
  - Render `<CliPackBridge ... />` alongside `<App />` so it mounts once.

3) Integrate with existing pack pipeline
- Prefer reusing the existing `usePreviewPack` instance used by UI to ensure a single worker and shared state:
  - Add a minimal event relay in `ContentArea` to expose imperative handlers:
    - Listen to custom DOM events `pf-cli-pack-request` and `pf-cli-pack-cancel` and call `pack()`/`cancelPack()`.
  - In `CliPackBridge`, dispatch those DOM events instead of creating a second `usePreviewPack` instance.
  - Subscribe to UI pack state progress via a dedicated custom event emitted by `ContentArea` (see Plan B for this emitter) to forward status/content to main.

4) Safety and edge cases
- If a CLI `start` arrives while packing, cancel current and start new (Last-write-wins) or reject new starts with a `FAILED` status; decide policy (recommend last-write-wins for simplicity).
- Debounce/throttle progress updates to avoid spamming main; ~10 updates/second is sufficient.

5) Logging
- Add concise console logs with a `CLI_PACK` tag in the bridge for start/cancel/progress/completion.

Deliverables for Plan A
- `src/components/cli-pack-bridge.tsx` (new)
- `src/main.tsx` (mount bridge)
- `src/components/content-area.tsx` (listen to custom events or expose a minimal emitter; see Plan B integration details)

---

## Plan B — Bidirectional Sync Implementation

Goal: Ensure CLI-triggered pack drives the same pipeline the UI uses and the renderer forwards status/content back to main, while UI reflects real-time progress.

1) Single source of truth for packing
- Let `ContentArea`’s `usePreviewPack` instance be the single pack engine.
- Add a small event bus via DOM CustomEvents to avoid tight coupling:
  - In `ContentArea`:
    - Listen: `window.addEventListener('pf-cli-pack-request', handler)` → calls `pack()`.
    - Listen: `window.addEventListener('pf-cli-pack-cancel', handler)` → calls `cancelPack()`.
    - Emit: on pack state changes (packing/progress/ready/error/cancelled), dispatch `pf-pack-state` with payload: `{ status, processed, total, percent, tokenEstimate, fullContent?, contentForDisplay? }`.

2) Bridge wires IPC ↔ UI state
- In `CliPackBridge`:
  - IPC → UI: on `cli-pack-start` → `dispatchEvent(new CustomEvent('pf-cli-pack-request', { detail: { options, id } }))` and store `id`.
  - IPC → UI: on `cli-pack-cancel` → `dispatchEvent(new Event('pf-cli-pack-cancel'))`.
  - UI → IPC: on `pf-pack-state` events, translate to `cli-pack-status` payloads:
    - Map `packing/streaming` → `RUNNING` with `progress` (computed percent) and send periodically.
    - Map `error` → `FAILED` with `message`.
    - Map `cancelled` → `CANCELLED`.
    - Map `ready` → send `cli-pack-content` with `{ id, content, fileCount }` (fileCount from `total`).

3) Option handling and overrides
- `prompt`:
  - Add a non-destructive, per-job override: pass `prompt` into the request event detail.
  - In `ContentArea` (before calling `pack()`), temporarily pass that `prompt` into `usePreviewPack` via a new optional prop or transient override:
    - Change `usePreviewPack` signature to accept an optional `overrideUserInstructions?: string` and use it when provided (doesn’t mutate app state).
- `includeTrees`:
  - Add an optional override to `usePreviewPack` (e.g., `overrideFileTreeMode?: FileTreeMode`). Map: `true` → `selected-with-roots`, `false|undefined` → use current.
- `maxFiles`/`maxBytes`:
  - Before `startPreview`, clamp `selectedFiles` to `maxFiles` and pre-filter by cumulative byte size for `maxBytes` using `allFiles[].size` to avoid overloading the worker.

4) Throttling status
- In `CliPackBridge`, coalesce `pf-pack-state` events; emit `cli-pack-status` at ~100–250ms intervals while packing.

5) Failure and recovery
- If the window is not initialized (no `ContentArea` yet), queue `cli-pack-start` for a short window (e.g., 3–5s) until `pf-pack-state` starts, otherwise return `FAILED` with a helpful message.

6) Testing and Verification
- Local test sequence:
  - Start app: `npm run dev:electron`.
  - In another terminal, run:
    - `pf preview start --prompt "Test" --follow --debug`
    - Confirm:
      - API server `POST /api/v1/preview/start` returns id.
      - Renderer logs `CLI_PACK start`.
      - UI shows “Packing…” progress.
      - `GET /api/v1/preview/status/:id` updates from `PENDING → RUNNING → SUCCEEDED`.
      - `GET /api/v1/preview/content/:id` returns content.
  - Cancel test: `pf preview cancel <id>` → status becomes `CANCELLED` and UI stops.
  - Watch test: `pf preview status <id> --watch` while packing → progress updates.

Deliverables for Plan B
- `src/components/content-area.tsx`: add listeners for `pf-cli-pack-request`/`pf-cli-pack-cancel` and emit `pf-pack-state` during lifecycle.
- `src/hooks/use-preview-pack.ts`: accept optional overrides (`overrideUserInstructions`, `overrideFileTreeMode`) and apply `maxFiles`/`maxBytes` capping logic before `startPreview`.
- `src/components/cli-pack-bridge.tsx`: wire IPC to DOM events and translate UI events to `cli-pack-status`/`cli-pack-content`.

---

## Rollout Strategy
1) Phase 1 (Minimal):
   - Add `CliPackBridge` and basic `ContentArea` event integration.
   - Forward `RUNNING/FAILED/CANCELLED` and `content` with no prompt/tree overrides.
2) Phase 2 (Enhancements):
   - Add overrides for `prompt` and `includeTrees` in `usePreviewPack`.
   - Apply `maxFiles`/`maxBytes` caps pre-flight.
   - Add throttling and improved logs.

## Risks
- Double workers if not carefully integrated: mitigated by routing CLI requests to the existing `ContentArea`/`usePreviewPack` instance via DOM events.
- Concurrency: limit to 1 active CLI job per window; document as known limitation.

## Acceptance Criteria
- CLI commands:
  - `pasteflow preview start --prompt "..." --follow` starts packing, UI shows progress, API status updates reflect progress, content retrievable.
  - `pasteflow preview status <id> --watch` tracks state from `RUNNING` → `SUCCEEDED/FAILED/CANCELLED`.
  - `pasteflow preview content <id> --raw` returns the packed content.
  - `pasteflow preview cancel <id>` cancels in-flight pack; UI updates accordingly; status becomes `CANCELLED`.

