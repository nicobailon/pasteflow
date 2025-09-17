# Phase 4 Implementation Plan — Enhancements (Diff/Terminal, Auto Rules UI, Timeline/Export)

This document is self-contained and describes the final enhancements: rich preview rendering, streaming controls, auto-approval rule UI, approvals timeline, and export integration. It assumes Phases 1–3 are complete.

---

## Objectives
- Deliver rich, actionable preview bodies (diffs, file ops, terminal output) with streaming and cancel.
- Provide an Auto-Approval Rules UI in settings and wire to preferences.
- Add approvals timeline to session history and include approvals in export payloads.

### Success Criteria
- Diff and terminal preview components render with syntax highlighting, chunking, and expand/collapse.
- “Stop/Cancel” interrupts streaming previews and records status.
- Auto rules can be created/edited in settings and applied in main with session caps.
- Export includes joined previews/approvals and UI shows an approvals timeline.

---

## Technical Requirements & Specs

### Rich Preview Rendering
- New components under `src/components/agent-approvals/`:
  - `diff-preview.tsx`: render hunks using logic consistent with `src/main/agent/tools/edit/diff-utils.ts`; show token counts, bytes, and existence flags. Collapse large hunks by default and support expand toggles; consider virtualization when lines > threshold.
  - `json-preview.tsx`: syntax-highlighted JSON fallback for unknown/unsupported previews.
  - `terminal-output-view.tsx`: provide a lightweight, text-only tail that reuses polling logic; avoid loading full xterm inside cards to reduce bundle weight. Provide a “Open in Terminal Panel” link for full xterm UI.
- Ensure all components accept readonly types and never mutate props (per `TYPESCRIPT.md`).

### Streaming & Interrupt
- Represent streaming state as `'pending' | 'running' | 'ready' | 'failed'` in the hook’s VM; disable action buttons until `ready` unless “Proceed while running” is allowed.
- Implement `cancel` wiring to `agent:approval:cancel-stream` and display partial output upon cancel.

### Auto-Approval Rules UI
- Extend `src/components/model-settings-modal.tsx`:
  - Add “Auto approvals” section to create rules (discriminated union: `tool`, `path`, `terminal` kinds) and set per-session caps.
  - Load/save via `agent:approval:rules:get/set` IPC.
  - Validate user input; show inline help and examples. Adhere to a11y rules. For glob matching, either add `micromatch` or begin with simple `startsWith/includes` patterns for MVP.

### Approvals Timeline & Export
- Timeline: add `src/components/agent-approvals/approval-timeline.tsx` or extend `src/components/agent-tool-calls.tsx` to show preview → decision → apply events with timestamps and reviewer.
- Export: extend `ipcMain.handle('agent:export-session', ...)` to include `{ approvals: { previews, approvals } }`. Update export consumer UI to display counts and link to timeline.

### Coding Standards
- Follow `TYPESCRIPT.md`: strict typing, literal unions, guards at boundaries, no `any`.
- Keep components accessible (semantic markup, roles, keyboard navigation, focus management).

---

## Implementation Steps
1. Build `diff-preview.tsx`, `json-preview.tsx`, and `terminal-output-view.tsx`; integrate with `AgentApprovalCard`.
2. Implement streaming status UI and the `cancel` action path.
3. Extend `model-settings-modal.tsx` with rules editor; wire IPC get/set and render rule lists.
4. Add approvals timeline and wire to hook state; provide links from cards to timeline entries.
5. Update export handler to include joined approvals data; adjust any export UI to show an approvals section.
6. Update docs in `AGENTS.md` describing new UI/behaviour.

---

## Effort & Risks
- Effort: Large/XL (rich rendering, streaming cancel, rules UI, export).
- Risks:
  - Performance on very large diffs → collapse + virtualization; lazy-load where feasible.
  - Terminal embedding increases bundle size → keep card preview text-only; link to full terminal panel.
  - Rules complexity and false positives → start with simple patterns; add micromatch later if needed.

---

## Testing & Validation (per `TESTING.md`)
- Add RTL tests:
  - `diff-preview` renders hunks and toggles collapse.
  - `terminal-output-view` streams output chunks and autoscrolls; handles cancel.
  - Rules UI: create/edit/delete rules, persist via IPC, and reflect back in the view.
  - Timeline shows correct sequence and metadata.
- Extend main-process tests:
  - Export includes approvals with correct counts.
  - Cancel streaming transitions status and retains partial output.
- Optional Playwright scenario for a full approval flow with cancel and rules.

---

## Dependencies
- Phases 1–3 complete (DB + service + renderer MVP).

---

## Acceptance Checklist
- [ ] Rich diff/terminal previews integrated into cards
- [ ] Streaming status and cancel work end-to-end
- [ ] Auto-approval rules UI persists and is enforced with caps
- [ ] Approvals included in export; timeline renders events
- [ ] Tests pass with behaviour-first coverage

---

## Scaffold Code Snippets (for rapid implementation)

These snippets provide minimal, type-safe components to render diffs, JSON fallback, and a light terminal tail.

### A) `src/components/agent-approvals/diff-preview.tsx` (skeleton)

```tsx
import React, { useMemo, useState } from 'react';

type DiffHunk = Readonly<{ header: string; lines: readonly string[] }>;
type Props = { hunks: readonly DiffHunk[]; collapsedByDefault?: boolean };

export default function DiffPreview({ hunks, collapsedByDefault = true }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const safeHunks = useMemo(() => Array.from(hunks), [hunks]);
  return (
    <div>
      {safeHunks.map((h, idx) => {
        const isOpen = expanded[idx] || !collapsedByDefault;
        return (
          <section key={idx} style={{ marginBottom: 8 }}>
            <header style={{ fontFamily: 'monospace', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>{h.header}</span>
              <button className="secondary" onClick={() => setExpanded((p) => ({ ...p, [idx]: !isOpen }))}>{isOpen ? 'Collapse' : 'Expand'}</button>
            </header>
            {isOpen && (
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, margin: 0 }}>{h.lines.join('\n')}</pre>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

### B) `src/components/agent-approvals/json-preview.tsx` (skeleton)

```tsx
import React from 'react';

export default function JsonPreview({ value }: { value: unknown }) {
  let text = '';
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{text}</pre>;
}
```

### C) `src/components/agent-approvals/terminal-output-view.tsx` (skeleton)

```tsx
import React, { useEffect, useRef, useState } from 'react';

type Props = { sessionId: string; previewId: string };

export default function TerminalOutputView({ sessionId, previewId }: Props) {
  const [cursor, setCursor] = useState(0);
  const [text, setText] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('terminal:output:get', { id: sessionId, fromCursor: cursor, maxBytes: 64 * 1024 });
        if (res?.success && res.data?.chunk) {
          setText((prev) => (prev + res.data.chunk).slice(-200000));
          setCursor(res.data.nextCursor ?? cursor);
        }
      } catch { /* noop */ }
      timerRef.current = window.setTimeout(poll, 500);
    }
    poll();
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [sessionId, cursor]);

  return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{text}</pre>;
}
```

### D) Rules UI fragment for `model-settings-modal.tsx`

```tsx
// Inside Model Settings Modal render
<section className="settings-section">
  <div className="field">
    <div className="field-label">Auto approvals</div>
    <div className="help" style={{ fontSize: 12 }}>Create simple rules to auto-approve safe operations. Example: tool=file action=write under tests/</div>
  </div>
  {/* Minimal MVP: show JSON textarea bound to agent.approvals.rules */}
  <textarea value={rulesJson} onChange={(e) => setRulesJson(e.target.value)} />
  <div style={{ marginTop: 8 }}>
    <button className="primary" onClick={() => saveRules(rulesJson)}>Save rules</button>
  </div>
</section>
```
