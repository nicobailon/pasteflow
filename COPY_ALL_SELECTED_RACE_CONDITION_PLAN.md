# PasteFlow – Plan to Fix Race Condition in "Copy All Selected"

## Summary

Intermittently, clicking "COPY ALL SELECTED" copies placeholders like "[Content is loading...]" instead of actual file contents. Retrying after a brief delay works. This is a classic race condition between asynchronous file loading/state updates and synchronous content assembly during the same render frame.

This plan details the root cause, a robust technical approach to detect readiness and block premature copying, UI/UX for progressive feedback, implementation steps, and a comprehensive testing strategy.

---

## Root Cause Analysis

Observed behavior: The copy action sometimes assembles content while some selected files have not yet finished loading, resulting in placeholder text being included.

Key code paths involved:

- Content assembly and copy orchestration (selected files):
  - `src/components/content-area.tsx`
    - `handleCopyWithLoading(getContent)` loads any not-yet-loaded selected files, then invokes `getContent()`.
    - The Copy button uses: `<CopyButton text={() => handleCopyWithLoading(getSelectedFilesContent)} />`.
  - `src/components/copy-button.tsx` handles async `text()` functions and writes to clipboard.
- Content formatting:
  - `src/utils/content-formatter.ts` generates the final string and inserts placeholders when file content is not loaded.
- Loading files and updating state:
  - `src/hooks/use-app-state.ts`:
    - `loadFileContent(filePath)` requests content and updates `allFiles` state, setting `isContentLoaded` once done.
    - A memoized selector `getFormattedContent` (a `useCallback`) captures `allFiles` and other dependencies.
  - `src/utils/virtual-file-loader.ts` offers parallelized file loading helpers and content caching.

Likely failure mode:

1. `handleCopyWithLoading` identifies unloaded selected files and awaits `loadFileContent` for each.
2. `loadFileContent` completes and updates React state (`setAllFiles`). However, React state updates are asynchronous; the component has not yet re-rendered.
3. Immediately after awaiting, `handleCopyWithLoading` calls the captured `getContent` function (e.g., `getFormattedContent`), which is a memoized callback created in a previous render and closes over a stale `allFiles` snapshot.
4. The formatter sees some selected files as not loaded and inserts the placeholder "[Content is loading...]".
5. If the user retries after re-render, the callback now sees the updated `allFiles` and produces the correct output.

Conclusion: The race stems from calling a memoized content selector that closes over stale state right after asynchronous loads, before React has re-rendered. Simply awaiting `loadFileContent` is insufficient to guarantee the selector sees the updated state in the same tick.

---

## Technical Approach

Address the issue on three fronts to make the UX resilient and data-accurate.

1) Prevent premature copying (disable until ready)

- Derive a readiness flag for selected files:
  - `isCopyReady = selectedFiles.every(f => fileMap.get(f.path)?.isContentLoaded && !fileMap.get(f.path)?.isCountingTokens && !fileMap.get(f.path)?.error)`.
- Disable the "COPY ALL SELECTED" button whenever `isCopyReady` is false.
- Keep this logic in the main state/selector layer (e.g., `use-app-state`) and expose to `ContentArea` as a prop to avoid duplication.

2) Provide progressive user feedback

- Expose a progress metric:
  - `selectedCount = selectedFiles.length`
  - `loadedCount = selectedFiles.filter(f => fileMap.get(f.path)?.isContentLoaded).length`
  - `loadingCount = selectedFiles.filter(f => fileMap.get(f.path)?.isCountingTokens).length`
  - `errorCount = selectedFiles.filter(f => fileMap.get(f.path)?.error).length`
  - `progress = loadedCount / selectedCount`
- UI on the button:
  - When disabled and loading: show spinner + "Loading X/Y" text and an inline progress bar (or determinate spinner) reflecting `progress`.
  - When any errors: show a warning icon and tooltip with count; clicking can open a small popover listing files with errors.
- Accessibility: Provide `aria-busy`, `aria-disabled`, and `aria-live="polite"` for progress updates.

3) Ensure data integrity during copy

- Avoid stale closures by building the content from a fresh data source right after loading.
- Preferred approach (robust, explicit):
  - Add a new utility to synchronously produce content from a supplied list/map of fully loaded file records.
  - For copy:
    1. Identify selected files not loaded; trigger parallel loads (existing `loadFileContent`).
    2. After all loads resolve, fetch the latest file records from a stable source that does not rely on a stale `useCallback` closure. Options:
       - A ref-based getter in `use-app-state` (e.g., `allFilesRef.current`) that always points to the latest state.
       - Or, call a new function that uses `VirtualFileLoader.loadMultipleFiles(selectedPaths)` to obtain loaded content directly, then format from those results.
    3. Build the formatted string using the freshly-retrieved file data (not the captured memo) and proceed to copy.
- This guarantees the formatter never sees stale `allFiles`, eliminating the placeholder text in copied content.

Recommendation: Implement the ref-based getter for simplicity and lower coupling, and keep the `VirtualFileLoader` approach as a fallback if needed.

---

## UI/UX Design for the Loading Indicator

- Button states:
  - Idle (ready): "COPY ALL SELECTED (N files)"
  - Loading (disabled):
    - Left-aligned inline spinner
    - Label: "Loading X/Y…"
    - Subtle determinate progress bar within the button (fills from 0 to 100%).
  - Error present (disabled):
    - Warning icon
    - Label: "Issues loading (E files)"
    - Tooltip: "Some files failed to load. View details."
- Behavior:
  - Progress updates as files transition to `isContentLoaded`.
  - Button becomes enabled only when `loadedCount === selectedCount && errorCount === 0`.
  - Maintain existing token-count display; clarify it reflects "loaded files only".

---

## Implementation Steps and Timeline

Phase 1 – State and readiness (0.5–1 day)

1. Add derived selectors in `use-app-state` (or a selector helper):
   - `selectedFilesLoadProgress`: `{ selectedCount, loadedCount, loadingCount, errorCount, progress }`.
   - `isCopyReady` boolean.
2. Expose these via context to `ContentArea`.

Phase 2 – UI updates (0.5 day)

3. Update `src/components/content-area.tsx`:
   - Pass `disabled={ !isCopyReady }` to `CopyButton`.
   - When disabled and `loadingCount > 0`, render progress UI inside the button.
   - When `errorCount > 0`, render error state/tooltip.
4. Minor style additions for the progress indicator (CSS/utility classes).

Phase 3 – Data integrity in copy pipeline (1 day)

5. In `use-app-state`, add `getLatestAllFiles()` via a `useRef` that mirrors `allFiles` on each render.
6. Replace `getSelectedFilesContent` usage in copy path:
   - Introduce `getSelectedFilesContentFromLatest()` that reads from `getLatestAllFiles()` synchronously at call time.
   - Update `handleCopyWithLoading` in `content-area.tsx` to call the new getter after awaiting the loads. Keep the preload step to load any missing content.
   - As an optional guard, verify post-load that every selected file has `isContentLoaded` and non-empty `content`; if not, show a non-destructive alert/toast and abort the copy.

Alternative (if ref approach is undesirable):

- Add a pure `formatSelectedFilesContent(files, selectedFiles, …)` function and, after loads, obtain up-to-date file data either from state or `VirtualFileLoader.loadMultipleFiles(selectedPaths)` to pass into the formatter. This bypasses any React state freshness concerns.

Phase 4 – Clipboard preview parity (0.5 day)

7. Ensure the clipboard preview modal uses the same freshness-safe content path as direct copy.

Phase 5 – Tests and hardening (0.5–1 day)

8. Update/add tests (see below). Ensure flaky behavior is eliminated.

Total estimate: ~2.5–3 days including review buffer.

---

## Testing Strategy

Unit tests

- Formatter:
  - Given mixed `isContentLoaded` flags, verify that placeholders appear only when explicitly requested; with the new data-integrity path, confirm no placeholders ever appear in the copied string.
- Selectors:
  - `selectedFilesLoadProgress` computes correct counts across loading, loaded, and error states.
  - `isCopyReady` toggles only when all selected files are fully loaded and error-free.

Integration tests (React Testing Library / Jest)

- Copy button disabled while loading:
  - Mock `requestFileContent` to resolve after a delay.
  - Select multiple files; assert "COPY ALL SELECTED" is disabled and shows "Loading X/Y" with progressing counts as promises resolve.
- Copy button enables after all loads:
  - After all mocked loads resolve, verify the button enables and no warning state is shown.
- Copy content integrity:
  - Trigger copy immediately after selection while loads are pending; assert `navigator.clipboard.writeText` is called only after all selected files are fully loaded.
  - Inspect the copied text for the absence of "[Content is loading...]" and presence of actual file contents.
- Error handling:
  - Simulate one file failing to load; assert the button remains disabled with an error indicator and copying does not occur.
- Clipboard preview modal:
  - Ensure preview uses the same freshness-safe content generation path and displays complete content.

E2E smoke (optional)

- Script a slow-loading workspace and verify visual progress and final copied content in a realistic flow.

---

## Risks and Mitigations

- Risk: Introducing ref-based state access could create hidden coupling.
  - Mitigation: Keep the ref read-only and well-documented; prefer pure function alternative if concerns arise.
- Risk: UI regressions in the button area.
  - Mitigation: Add snapshot tests and verify existing integration tests for selection/token counts still pass.
- Risk: Performance for very large selections.
  - Mitigation: Preserve existing concurrency limits (`virtual-file-loader.ts`), and keep the progress UI lightweight.

---

## Acceptance Criteria

- The "COPY ALL SELECTED" button is disabled until all selected files have fully loaded content and no load errors exist.
- While disabled due to loading, the button displays a clear progress indicator (e.g., "Loading X/Y…" and a determinate progress bar/spinner).
- Triggering copy, even immediately after selecting files, always produces complete content with no "[Content is loading...]" placeholders.
- Integration tests demonstrate the absence of the race condition and validate the progress UI and disabled state behavior.
- The clipboard preview modal uses the same safe content generation approach and never shows placeholders in copied content.

