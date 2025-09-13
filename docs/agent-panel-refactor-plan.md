# Agent Panel Simplification Refactor Plan

## Scope & Goals

- Remove these Agent Panel–specific features only:
  1) `agent-mini-file-list` component (entirely)
  2) Selected context files functionality in the Agent Panel (local file selection/attachments UI and logic)
  3) Agent Panel @-mention autocomplete file selection
- Keep the main content area’s selected files and @-mention autocomplete fully intact and unchanged.
- Avoid breaking existing functionality elsewhere.

## Current Architecture (Agent Panel)

- Core: `src/components/agent-panel.tsx`
  - Manages session (`useChat`), threads/usage state, banners, and composer state.
  - Panel-local context attachments:
    - `pendingAttachments: Map<string, AgentAttachment>` in panel state.
    - Selection via `AgentMiniFileList` (checkbox list, adds/removes from `pendingAttachments`).
    - Display via `AgentAttachmentList` (chips rendered from `pendingAttachments`).
    - Submit path builds code blocks per attachment and prepends to outgoing message; also sets `context.dynamic.files`.
    - Content loading via `useAttachmentContentLoader` for attachments.
  - Panel @-mention autocomplete:
    - `AgentChatInputWithMention` (textarea + dropdown) builds items from `allFiles`, shows `AgentFileAutocomplete` dropdown, and on select inserts `@rel/path[:start-end]` then calls `onFileMention` to add to `pendingAttachments`.
  - External context handoff (from main content area) remains via `useSendToAgentBridge` and can send `fullText` (already containing embedded files), independent from panel-local attachments.

## Features To Remove (Agent Panel only)

1. `agent-mini-file-list` component and its usage.
2. Panel-local selected context files functionality:
   - `pendingAttachments` state and all attachment UI/logic.
   - Attachment display chips and token-count hinting.
   - Attachment content loading (`useAttachmentContentLoader`) and dynamic files in request.
3. Panel @-mention autocomplete:
   - `AgentChatInputWithMention` and `AgentFileAutocomplete` usage in the panel.

Main content area (`src/components/content-area.tsx`) must remain unchanged, including its selected files view and @-mention autocomplete.

## Files, Components, and Code Sections

Impacted components and files:

- To delete (panel-only UI):
  - `src/components/agent-mini-file-list.tsx`
  - `src/components/agent-attachment-list.tsx`
  - `src/components/agent-chat-input.tsx`
  - `src/components/agent-file-autocomplete.tsx`

- To update (panel logic and wiring):
  - `src/components/agent-panel.tsx`
    - Remove imports: `AgentMiniFileList`, `AgentAttachmentList`, `AgentChatInputWithMention`, `useAttachmentContentLoader`.
    - Remove `pendingAttachments` state and all reads/writes.
    - Replace `<AgentChatInputWithMention ... />` with a plain controlled `<textarea className="agent-input" ... />` using the existing overlay/submit button layout.
    - Update placeholder (remove @-mention hint).
    - Update `handleSubmit` to send only the composer text (no attachment blocks).
    - Update `prepareSendMessagesRequest` to drop `dynamic.files` or set to an empty list (keep `initial`/`workspace`).
    - Remove token hint computation tied to attachments (calculate from `composer.length` only or remove if unused).

- Optional clean-up (post-change verification):
  - `src/hooks/use-attachment-content-loader.ts` — becomes unused; remove if unreferenced after refactor.

- Do NOT modify (must remain intact):
  - `src/components/content-area.tsx` (main area instructions and autocomplete)
  - `src/components/content-area.css` (autocomplete styles used by main area)

## Refactor Steps

1) Remove Agent Mini File List
- Delete `src/components/agent-mini-file-list.tsx`.
- In `agent-panel.tsx`, remove the import and the `<AgentMiniFileList ... />` JSX block.
- Remove any handlers (`onToggle`, `onTokenCount`) tied to it.

2) Remove Panel-Local Selected Context Files
- Delete `src/components/agent-attachment-list.tsx`.
- In `agent-panel.tsx`:
  - Remove `pendingAttachments` state and all `setPendingAttachments` calls.
  - Remove `<AgentAttachmentList ... />` render block.
  - Remove import and usage of `useAttachmentContentLoader`.
  - In `handleSubmit`, stop building `llmBlocks` from attachments; send `composer.trim()` only.
  - In `prepareSendMessagesRequest`, do not include `dynamic.files` from `pendingAttachments` (omit or set to empty).
  - Adjust token hint computation (composer-only) or strip if unused by UI.

3) Remove Panel @-Mention Autocomplete
- Delete `src/components/agent-chat-input.tsx` and `src/components/agent-file-autocomplete.tsx`.
- In `agent-panel.tsx`:
  - Replace `<AgentChatInputWithMention ... />` with a simple `<textarea>` wired to `composer`/`setComposer`.
  - Remove `onFileMention` callback.
  - Update placeholder to "Message the Agent…" (without @ hint).

4) Preserve Main Content Area
- No changes to `content-area.tsx` or its autocomplete logic.
- Keep autocomplete CSS in `content-area.css`.

5) Clean Up & Verify
- Remove unused imports/types.
- Confirm `use-attachment-content-loader.ts` is unused and delete if so.
- Ensure `useSendToAgentBridge` behavior remains unchanged (still can receive `fullText` and `initial` context from main area events).
- Confirm API payload still contains `context.initial` and `workspace` fields; `dynamic.files` omitted/empty is tolerated by server.

## Test Impact & Updates

Tests to remove or rewrite (depend on removed features):
- `src/__tests__/agent-mention-autocomplete.test.tsx`
- `src/__tests__/agent-mention-line-range.test.tsx`
- `src/__tests__/agent-panel-file-lines-display.test.tsx`
- `src/__tests__/agent-context-body-and-order.test.tsx` (dynamic from panel)

Tests needing minor tweaks (placeholder text):
- `src/__tests__/agent-panel-input-interaction.test.tsx`
- `src/__tests__/agent-panel-multi-send.test.tsx`

Add/update tests that validate simplified behavior:
- Typing/sending from the panel without attachments succeeds.
- Panel does not render any mini-file list or attachment chips.
- Content area continues to provide autocomplete and can "Send to Agent" with `fullText` (integration path).

## Dependencies & Side Effects

- Server API should accept missing/empty `context.dynamic` (only `context.initial` from main area is used when present).
- Removing `pendingAttachments` eliminates panel-local token aggregation and precise token hover fetches (OK by scope).
- `content-area` functionality unmodified; its features must pass existing tests.
- `use-attachment-content-loader.ts` likely becomes dead code; remove if confirmed unused.

## Rollout & Validation

1. Implement code removals and replacements in `agent-panel.tsx`.
2. Delete the four panel-only components listed above.
3. Run `npm run lint` and `npm test` and fix/import cleanups.
4. Update/remove affected tests; ensure main content area tests still pass.
5. Manual QA:
   - Panel loads, resizes, and can send/stop messages.
   - No mini file list or attachment chips present.
   - No @-mention dropdown appears in the Agent Panel.
   - Main content area autocomplete and selected files behave as before.
   - "Send to Agent" from main area still streams content to the panel.

## Revert Plan

- Re-introduce `pendingAttachments` state and its UI components if needed:
  - Restore `agent-mini-file-list.tsx`, `agent-attachment-list.tsx`, `agent-chat-input.tsx`, and `agent-file-autocomplete.tsx`.
  - Wire back `useAttachmentContentLoader`, token hinting, and `prepareSendMessagesRequest` dynamic files.

## Checklist

- [x] Remove mini file list (component + usage)
- [x] Remove panel-local attachments (state, UI, loader, dynamic.files)
- [x] Replace panel input with plain textarea; remove @-mention logic
- [x] Keep main content area unchanged
- [x] Clean unused imports and dead code (`use-attachment-content-loader.ts` if unused)
- [x] Update/remove affected tests and placeholders
- [ ] Validate API payload and end-to-end flows
