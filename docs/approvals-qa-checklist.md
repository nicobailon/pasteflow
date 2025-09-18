# Approvals QA Checklist

Use this checklist to validate the immediate cutover (Phase 5) approvals experience before release.

1. **Baseline**
   - Launch the app via `npm run dev:electron` using a workspace fixture with pending approvals.
   - Confirm the approvals panel renders without toggles or feature flags.

2. **Approve with edits**
   - Open a file/edit approval.
   - Use *Approve with edits*, modify the JSON payload, and apply.
   - Verify the target file reflects the edited content and the approval card disappears.
   - Check the chat transcript for a reviewer feedback message referencing the approval.

3. **Reject with feedback**
   - Reject a pending approval with feedback text.
   - Confirm the card resolves, feedback persists in the approval timeline, and a reviewer note appears in chat.

4. **Cancel terminal preview**
   - Trigger a streaming terminal preview (e.g., long-running command) and click *Cancel*.
   - Ensure the command stops within ~1s, the card resolves to *failed (cancelled)*, and timeline notes the cancellation.

5. **Auto-approved tray**
   - Configure an auto-approval rule (Settings → Auto approvals) and trigger a matching preview.
   - Confirm the new auto-approved entry appears in the tray with the expected reason and links to the timeline.

6. **Timeline + Export**
   - Open the approvals timeline for the current session and spot entries for apply/reject/cancel actions.
   - Export the session via **Export session** and inspect the JSON: approvals payload should include feedback text, feedback metadata, and `beforeHash`/`afterHash` (when applicable).

7. **Regressions**
   - Toggle bypass approvals and ensure cards respect the bypass state.
   - Run `npm run test`, `npm run build`, and `npm run test:e2e` to confirm automated coverage remains green (Playwright harness drives the approvals list interactions).

Document pass/fail notes alongside screenshots or captured JSON for each step.
