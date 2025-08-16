# PasteFlow – Updated Plan to Fix Race Condition in "Copy All Selected" (v2)

Date: 2025-08-16

This document revises the earlier plan to match the current codebase. It validates the root cause, confirms current wiring, and updates the approach, steps, and tests accordingly.

## Executive Summary

- The copy pipeline still calls a memoized content getter immediately after awaiting async loads, which can close over stale state and include placeholders like "[Content is loading...]".
- We will: (1) disable copying until all selected file contents are fully loaded; (2) show progressive loading on the button; (3) generate copy content from up-to-date state to avoid stale closures; and (4) ensure the preview uses the same integrity-safe path.

## Current Code Review (as of today)

Key files and observations:

- src/components/content-area.tsx
  - handleCopyWithLoading(getContent): loads unloaded selected files with `loadFileContent`, then immediately `return getContent()`.
  - Copy button: `<CopyButton text={() => handleCopyWithLoading(getSelectedFilesContent)} />`
  - Preview flow: `handlePreview` uses the same handleCopyWithLoading(getSelectedFilesContent) and opens ClipboardPreviewModal.
- src/index.tsx
  - Passes `appState.getFormattedContent` into ContentArea as `getSelectedFilesContent`.
- src/hooks/use-app-state.ts
  - getFormattedContent is a `useCallback` depending on `[allFiles, fileSelection.selectedFiles, sortOrder, fileTreeMode, selectedFolder, selectedSystemPrompts, selectedRolePrompts, selectedInstructions, userInstructions]` and calls `getSelectedFilesContent(...)`.
  - loadFileContent(filePath): updates `allFiles` via `setAllFiles` after content and token computation; uses cache; guards duplicate loads.
  - Provides loadMultipleFileContents and many selectors/utilities.
- src/utils/content-formatter.ts
  - When formatting, if a selected file’s `isContentLoaded` is false or `content` is undefined, it injects:
    ```
    File: <path>
    ```
    [Content is loading...]
    ```
    ```
- src/components/copy-button.tsx
  - Accepts either a string or a function; if function returns a Promise, awaits it and copies. No built-in disabled/loader state is currently wired for the "copy all selected" variant.
- src/components/clipboard-preview-modal.tsx
  - Preview copy uses `onCopy` passed from ContentArea, which writes `previewContent` directly.
- src/utils/virtual-file-loader.ts
  - Provides caching and concurrent loads; no change affecting this race specifically.

Conclusion: The wiring matches the original analysis; the stale-closure risk remains. Placeholders are still emitted when content isn’t yet loaded.

## Validated Root Cause

- After `await Promise.all(unloadedFiles.map(loadFileContent(...)))`, React state updates to `allFiles` are not guaranteed to have re-rendered before `getContent()` is invoked. Since `getContent` is the memoized `getFormattedContent` from the prior render, it may observe stale `allFiles` and insert "[Content is loading...]".

## Updated Technical Approach

1) Prevent premature copying (disable until ready)

- Derive readiness and progress from current state:
  - For each `selectedFile`, find `fileData` in `allFiles`.
  - Consider a file "ready" when `isContentLoaded === true`, `isCountingTokens === false`, and no `error`.
  - isCopyReady = selectedCount > 0 && every selected file ready.
  - Expose `{ selectedCount, loadedCount, loadingCount, errorCount, progress }` and `isCopyReady` from use-app-state.
- ContentArea: pass disabled={!isCopyReady} to CopyButton and render progress UI on the button when disabled due to loading.

2) Provide progressive loading indicator on the button

- Button label while disabled and loading: "Loading X/Y…" with determinate progress bar (or determinate spinner) reflecting `progress`.
- If any errors among selected: show a warning state and tooltip; keep button disabled and provide a link to retry loads or view details.
- Accessibility: aria-disabled, aria-busy, aria-live="polite".

3) Ensure data integrity (fresh data when generating copy)

- Add a freshness-safe getter that doesn’t rely on the previous render’s closure:
  - In use-app-state, mirror `allFiles` into a `useRef` (allFilesRef.current). Provide `getLatestAllFiles()`.
  - Create `getFormattedContentFromLatest()` that calls `getSelectedFilesContent(getLatestAllFiles(), …current selections/prompts…)`.
- Update copy flow in ContentArea:
  - After `await`ing loads, call `getFormattedContentFromLatest()` rather than the memoized `getSelectedFilesContent` prop.
  - Optional: verify every selected file is ready; if not, abort copy and show a toast.
- Use the same freshness-safe path for the Preview modal content and for copying from preview.

Notes:
- Alternatively, introduce a pure `formatSelectedFilesContent(files, selectedRefs, …)` and pass in the current `allFiles` directly from state (or via loader) at call time; but the ref getter is simplest and consistent.

## UI/UX Design Details

- Button states:
  - Ready: "COPY ALL SELECTED (N files)"
  - Loading/disabled: spinner + "Loading X/Y…" and a thin progress bar inside the button; tooltip clarifies loading statuses.
  - Error/disabled: warning icon + "Issues loading (E files)" with tooltip; clicking opens an error details popover.
- Token count label remains "~… tokens (loaded files only)".

## Implementation Steps

Phase 1 – State readiness (0.5–1 day)
- In use-app-state:
  - Add selectors/hooks to compute: `selectedFilesLoadProgress` and `isCopyReady`.
  - Add `allFilesRef` and `getLatestAllFiles()`; add `getFormattedContentFromLatest()`.
- Export these via the existing appState object.

Phase 2 – ContentArea and UI (0.5–1 day)
- In ContentArea:
  - Replace `handleCopyWithLoading(getSelectedFilesContent)` with a version that, after loads resolve, calls `appState.getFormattedContentFromLatest()`.
  - Pass `disabled={!appState.isCopyReady}` to CopyButton.
  - Render progress UI and error state inside the button (CSS additions as needed).
- Ensure preview flow calls the new freshness-safe getter and respects readiness.

Phase 3 – Integrity guards (0.25 day)
- Post-load guard: verify every selected file is ready before generating/copying. If not, surface a non-destructive message and do not copy.

Phase 4 – Tests (0.75–1 day)
- Unit tests: selectors for progress/ready; content generation without placeholders once ready.
- Integration tests:
  - Button disabled and shows "Loading X/Y…" while loads pending; becomes enabled when done.
  - Immediate click during loading doesn’t copy; copy happens only once ready and content has no placeholders.
  - Error case keeps button disabled and shows error indicator.
  - Preview uses same safe path and shows complete content.

## Timeline

- Total estimate: ~2–3 days including review and polishing.
  - Phase 1: 0.5–1 day
  - Phase 2: 0.5–1 day
  - Phase 3: 0.25 day
  - Phase 4: 0.75–1 day

## Risks and Mitigations

- Stale state in other areas: Use the same `getLatest*` pattern only in latency-sensitive paths; keep rest with React idioms.
- UI polish: Keep progress UI minimal; add tests for button states.
- Large selections: Keep existing loader concurrency; avoid reflow-heavy components in the button.

## Acceptance Criteria

- Copy button is disabled until all selected files have fully loaded and no errors.
- While disabled due to loading, the button shows a determinate progress indicator.
- Copied content and preview content never include "[Content is loading...]" placeholders.
- Tests cover readiness logic, progress UI, and integrity of copied content.

