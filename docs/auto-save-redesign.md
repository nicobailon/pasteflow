## PasteFlow Auto-Save: Current State Analysis and Event-Driven Redesign Plan

### Executive Summary
- PasteFlow currently uses a hook-based auto-save that reacts to workspace state changes and performs a debounced save after verifying a computed signature has changed. There is no evidence of a periodic `setInterval` timer for auto-save; timing is managed via short debounces and lifecycle events (beforeunload, visibilitychange, Electron app-will-quit).
- You requested an event-driven auto-save that triggers immediately after user interactions (keystrokes, selections, file tree setting changes, and any state changes) while avoiding excessive writes. The current architecture is close to this already but can be made more explicit, robust, and efficient with a centralized scheduler, per-event policies, and micro-batching.
- This document maps the current implementation, identifies all relevant trigger points, and proposes a detailed redesign and migration plan.

---

### 1) Current Auto-Save Implementation: What Exists Today

Key modules and functions
- src/hooks/use-workspace-autosave.ts
  - Exports useWorkspaceAutoSave(options): Hook that:
    - Computes a "workspace signature" from state slices (selection, file tree, prompts, user instructions, etc.).
    - Uses a debounced save function (default 100ms) to call onAutoSave when the signature changes.
    - Maintains guards to prevent saving during app state application or while processing.
    - Listens to Electron IPC `app-will-quit`, window `beforeunload`, and `visibilitychange` to flush saves.
    - Stores user preferences at key pasteflow.prefs.workspace.autosave: { enabled, debounceMs, minIntervalMs }.

- src/hooks/use-app-state.ts
  - Integrates the hook by passing the current workspace slices to useWorkspaceAutoSave.
  - Defines performAutoSave(): builds the full workspace state and delegates to saveWorkspace(name, workspace).
  - Also provides a manual save (saveCurrentWorkspace) used by header UI.

- src/hooks/use-workspace-state.ts and src/hooks/use-database-workspace-state.ts
  - Validate and persist workspace state via db.saveWorkspace(name, workspace) (IPC to main/db implementation).

- src/utils/debounce.ts and src/utils/throttle.ts
  - Debounce: used by auto-save hook for micro-batching; Throttle available but not used by auto-save.

- UI hooks and components related to save UX
  - src/components/app-header.tsx: shows AutoSaveToggle and a manual Save button.
  - src/components/auto-save-toggle.tsx: toggle UI bound to hook preference.
  - src/components/workspace-save-button.tsx: manual save button with states (saving, success).

Timing and triggers observed
- Debounced trigger: useEffect inside useWorkspaceAutoSave watches the computed signature and calls a debounced save (default 100ms) when the signature differs from last save.
- Lifecycle triggers: visibilitychange (hidden) and beforeunload; Electron app-will-quit triggers immediate save.
- No periodic setInterval-based auto-save identified in retrieved sources; timing is event-driven with short debounce.

Data flow (current)
1) User interactions update workspace-related state (selection, search term, expanded nodes, prompts, userInstructions, etc.).
2) use-app-state.ts passes all relevant slices into useWorkspaceAutoSave.
3) useWorkspaceAutoSave computes a deterministic signature and, on change, schedules a debounced performAutoSave.
4) performAutoSave (from use-app-state.ts) rebuilds the full WorkspaceState and calls saveWorkspace(name, state).
5) saveWorkspace validates selectedFolder, then db.saveWorkspace(name, state) writes to the database.

Summary of save guards
- Auto-save disabled or no current workspace: skip.
- During applyWorkspace or processing: skip.
- If current signature equals lastSignatureRef: skip.
- saveInProgressRef ensures no overlapping saves; lastSaveTimeRef and minIntervalMs exist (default 0) but aren’t actively rate-limiting.

---

### 2) User Interaction Points That Should Trigger Auto-Save

Workspace-affecting interactions (should trigger a save):
- Text areas/editors
  - User instructions text
  - Prompt authoring/edits (system/role, titles, content)
  - Search input (if persisted in workspace)
  - Exclusion patterns input
  - Any rename fields (workspace name handled separately by save button; a rename of internal nodes that persist should trigger)

- Selection changes
  - Folder selection (selectedFolder)
  - File selection(s) and line ranges (selectedFiles)
  - Prompt selection (selected system/role prompts)

- File tree settings
  - Expanded/collapsed nodes
  - Sort order and fileTreeMode

- Other persisted workspace state
  - Selected instructions (ids)
  - Any UI state that the app serializes into WorkspaceState

Non-workspace interactions (should not trigger)
- Theme changes, transient UI decoration, ephemeral popovers, etc., unless explicitly serialized in workspace state.

Note: The current architecture already feeds these slices into the signature; therefore, any of these interactions currently cause a debounced save via the hook.

---

### 3) Issues and Opportunities in the Current Approach

- Debounce-only policy: Keystrokes trigger saves but are batched with a short 100ms debounce. Under rapid typing, this prevents flooding but may still result in frequent writes and JSON serialization.
- Centralization: Triggers are implicit via React state changes and signature changes; there is no centralized auto-save scheduler surface to attribute reasons, classify priorities, or apply different policies per event type.
- Concurrency/backpressure: There’s a single saveInProgressRef gate, but no queueing/prioritization, nor dynamic adaptation under load.
- Observability: Limited structured logging or metrics for save rates, reasons, and durations.
- Misconception risk: The behavior is event-driven already, but without explicit event typing/policy. Moving to a clearer event-driven design improves maintainability and testability.

---

### 4) Proposed Event-Driven Auto-Save Redesign

Goals
- Trigger on all meaningful workspace state changes with the appropriate immediacy.
- Micro-batch and coalesce to avoid excessive writes, especially during keystrokes.
- Maintain strong correctness guarantees (no lost updates; flush on quit/blur).
- Provide observability and policy control per event type.

Core design elements
1) Central AutoSaveScheduler service (renderer)
   - API
     - trigger(event: AutoSaveEvent): void
       - AutoSaveEvent: { type: 'keystroke' | 'selection' | 'file-tree' | 'prompt-change' | 'instruction-change' | 'other'; priority?: 'low' | 'normal' | 'high'; meta?: Record<string, unknown> }
     - flushNow(reason?: string): Promise<void>
     - setEnabled(enabled: boolean): void
     - setPolicy(policy: AutoSavePolicy): void
   - Behavior
     - Batches events within a frame (requestAnimationFrame) and applies per-type policies: debounce windows, min intervals, and dedupe by signature.
     - Guards against overlapping saves; if a save is in progress, coalesce another save and run trailing.
     - Emits structured logs/metrics (rate, durations, reasons).

2) Per-event policies
   - Keystroke: trailing debounce 250ms (configurable). Leading=false to avoid double-writes at start of typing.
   - Selection change (file/doc/prompt): save ASAP with tiny debounce 50–75ms to coalesce rapid multi-select.
   - File tree settings (expand/collapse/sort/mode): debounce 100–150ms to group multiple toggles.
   - High-priority actions (e.g., destructive operations, workspace switch): flushNow.
   - Visibility/lifecycle: on visibilitychange(hidden) or app-will-quit/beforeunload, flushNow if dirty.

3) Signature and dirty tracking
   - Keep the existing computeWorkspaceSignature approach but expose it to the scheduler.
   - Maintain lastSavedSignature and currentSignature; skip saves if equal.
   - Maintain a coarse dirty flag for quick checks; reset on successful save.

4) Concurrency and error handling
   - Single-flight saving: saveInProgress -> queue trailing save if additional events arrive, then run once more if signature changed.
   - Exponential backoff or simple retry for transient DB errors (limited attempts), with user notification on persistent failure.

5) Configuration and preferences
   - Retain pasteflow.prefs.workspace.autosave (enabled boolean) and add optional per-event debounce policy preferences; default sensible values.
   - Keep UI toggle unchanged; add developer-only logs/metrics behind a flag.

6) Integration points
   - use-app-state.ts: Replace direct useWorkspaceAutoSave debounce with scheduler-based triggers.
   - Where state setters run (text inputs, selection handlers, file tree actions), call scheduler.trigger(...) with an appropriate event type. As an incremental step, we can keep the signature-change observer while we gradually add explicit triggers to high-traffic handlers.
   - Keep lifecycle listeners (app-will-quit, beforeunload, visibilitychange) wired to scheduler.flushNow().

Illustrative scheduling logic (pseudocode)
- On trigger(event):
  - Record event in a short-lived queue; mark dirty.
  - Schedule per-event debounce timer (distinct timers per type) to call maybeSave().
- maybeSave():
  - If disabled or guards deny, return.
  - If currentSignature === lastSavedSignature, clear dirty and return.
  - If saveInProgress: mark pending=true and return.
  - Else perform save -> on success update lastSavedSignature, clear dirty; if pending, run maybeSave() once more.

---

### 5) Event Matrix (Initial Defaults)

- Keystroke (text areas/editors): debounce 250ms trailing.
- File/doc/prompt selection change: debounce 50–75ms trailing.
- File tree expand/collapse/sort/mode/exclusion patterns: debounce 100–150ms trailing.
- Search term or filters: debounce 150ms trailing.
- Explicit high-priority (workspace deletion, rename finalize, workspace switch): flushNow.
- Lifecycle (window blur/visibility hidden, app-will-quit, beforeunload): flushNow if dirty.

Note: Values are initial defaults; make them configurable via preferences with safe ranges.

---

### 6) Performance Considerations and Optimizations

- Write coalescing
  - Per-type debounces plus frame-level coalescing reduce write amplification.
  - Skip save if signature unchanged (already implemented).

- Serialization cost
  - Building full WorkspaceState for every save can be costly. Options:
    - Build state lazily from current atoms/selectors only at save time (as done now).
    - Consider partial diffing to avoid heavy recomputation; however, DB currently stores state_json, so full JSON update is expected. Stick with full state for correctness; optimize the builder if needed.

- DB contention and I/O
  - Single-flight saves + trailing run reduce overlapping writes.
  - Consider a minimal inter-save interval under extreme load (e.g., 100ms floor) as a circuit breaker.

- Observability
  - Log: event type, wait time (debounce), save duration, skipped-by-signature counts.
  - Add a dev toggle to print stats to console.

---

### 7) Migration Strategy from Current Debounced Approach

- Phase 0: Keep behavior stable
  - Preserve existing useWorkspaceAutoSave API and preference keys; internally refactor to delegate to AutoSaveScheduler while keeping the signature change observation in place.

- Phase 1: Introduce AutoSaveScheduler
  - Implement scheduler with per-event debounce queues and single-flight save.
  - Wire lifecycle events (visibilitychange, beforeunload, app-will-quit) to scheduler.flushNow.
  - Maintain the existing signature-change effect to call scheduler.maybeSave(), so we do not regress if some triggers are missed.

- Phase 2: Add explicit triggers
  - In high-traffic handlers (text areas/editors), call scheduler.trigger({ type: 'keystroke' }).
  - In selection change handlers, call trigger({ type: 'selection' }).
  - In file tree setting handlers, call trigger({ type: 'file-tree' }).
  - Gradually remove or simplify the signature-change effect once coverage is complete and tested.

- Phase 3: Remove any legacy periodic timers (if discovered)
  - No setInterval-based auto-save identified; if found elsewhere, remove and rely on scheduler.

- Phase 4: Tune defaults and add preferences
  - Expose debounceMs per event type in preferences UI (optional/advanced).

---

### 8) Backward Compatibility Considerations

- Keep preference key pasteflow.prefs.workspace.autosave and default enabled=true.
- Keep AutoSaveToggle component behavior unchanged.
- Keep manual save UX unchanged (header button and workspace-save-button).
- Maintain IPC flush behavior on app quit and unload.
- Maintain computeWorkspaceSignature semantics to avoid unnecessary saves across versions.

---

### 9) Testing Plan

Unit tests
- AutoSaveScheduler
  - Triggers coalesced per event type; verify debounce windows respected.
  - Single-flight saves with trailing save if signature changes during an in-flight save.
  - Skip when signature unchanged; ensure dirty flag clears.
  - FlushNow behavior under various dirty states and with in-flight save.

- Hook integration
  - useWorkspaceAutoSave delegating to scheduler; signature-change effect invokes maybeSave() correctly.
  - Preference toggling enables/disables saves.

Integration tests
- Simulate typing in userInstructions: many keystrokes result in limited saves with trailing save on idle.
- Rapid selection changes: minimal saves due to small debounce.
- File tree toggles: multiple expand/collapse within 100ms -> one save.
- Lifecycle events: visibilitychange(hidden) and app-will-quit trigger flush with dirty state.

E2E (optional)
- Typical session with mixed interactions results in correct persisted state and acceptable save counts.

---

### 10) Implementation Steps (Detailed)

1) Introduce AutoSaveScheduler (new file: src/auto-save/auto-save-scheduler.ts)
   - Implement event queues, per-type debouncers, dirty/signature tracking, single-flight saves, flushNow.
   - Accept injected callbacks: getCurrentWorkspaceName(), buildWorkspaceState(), persist(workspaceName, state), computeSignature().

2) Refactor useWorkspaceAutoSave
   - Internally create and configure the scheduler on mount, connect lifecycle listeners to flushNow.
   - Keep signature-change effect, but instead of directly debouncing performAutoSave, call scheduler.maybeSave().
   - Expose isAutoSaveEnabled and setAutoSaveEnabled via scheduler.

3) Add explicit triggers in high-signal interaction handlers
   - Text inputs/editors: onChange -> scheduler.trigger({ type: 'keystroke' }).
   - Selection handlers (files/prompts): scheduler.trigger({ type: 'selection' }).
   - File tree updates (expand/sort/mode/exclusions): scheduler.trigger({ type: 'file-tree' }).
   - Search field: scheduler.trigger({ type: 'other' | 'filter' }).
   - Workspace switch: scheduler.flushNow before switch; after switch, scheduler resets state/signature.

4) Observability
   - Add console.debug logs (behind a flag) for saves: reason, duration, skipped-by-signature counts.

5) Configuration
   - Add optional preferences per event type (advanced) but keep current UI minimal.

6) Remove legacy periodic timers (if any discovered during refactor) and redundant debounces.

---

### 11) Open Questions / Clarifications
- Editors involved: Are there any rich text or code editors with their own change events that bypass React state? Ensure we tap into those for triggers.
- Workspace name semantics: Currently manual save handles overwrite/rename flows; confirm we should not auto-save workspace name changes until rename finalized.
- DB backend: We’ve seen both secure-database.ts and database-implementation.js in the repo; confirm the active path and whether any migration work is pending that could affect write rates or schema.
- Maximum acceptable save frequency: Are there operational constraints (e.g., SSD writes, mobile targets)? If so, introduce a global low-watermark minIntervalMs.

---

### 12) Conclusion
The current system is already largely event-driven with debounced saves based on a robust signature comparison. The proposed redesign formalizes event types and policies, introduces a centralized scheduler for coalescing and concurrency control, and improves observability. Migration can be incremental with minimal user-facing change, preserving current preferences and UI while delivering better performance and reliability under heavy interaction.

