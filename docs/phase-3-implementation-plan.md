# Phase 3 Implementation Plan — Renderer MVP (Hooks, IPC, UI Cards)

This document is self-contained and covers the renderer-side MVP: state management, preload wrappers, approval list/cards, and panel integration behind a feature flag. It assumes Phase 1–2 are complete.

---

## Objectives
- Provide a first-class approvals experience in the UI: list pending approvals, show preview metadata, and allow approve/reject actions.
- Wire typed preload wrappers for the new IPC endpoints and subscribe to approval broadcasts.
- Integrate the approvals list into the Agent panel with a feature flag (`AGENT_APPROVAL_V2`).

### Success Criteria
- `useAgentApprovals` hook exposes typed state and actions (`approve`, `approveWithEdits`, `reject`, `cancel`, `setBypass`, `setRules`).
- `AgentApprovalList` + `AgentApprovalCard` render pending approvals with metadata and buttons.
- `AgentPanel` conditionally renders the approvals UI when the feature flag is on; otherwise legacy behaviour remains.

---

## Technical Requirements & Specs

### Preload Wrappers
- File: `src/main/preload.ts`
  - Add allowlist entries for `agent:approval:list`, `agent:approval:watch`, `agent:approval:apply`, `agent:approval:apply-with-content`, `agent:approval:reject`, `agent:approval:cancel-stream`, `agent:approval:rules:get`, `agent:approval:rules:set` and `'agent:approval:new'`/`'agent:approval:update'` receive channels.
  - Expose typed helpers (inline) that `ensureSerializable` both on input and output.
  - Ensure listeners are deregistered via the existing wrapper machinery.

### Hook: `useAgentApprovals`
- File: `src/hooks/use-agent-approvals.ts`
  - Input: `{ sessionId: string | null; enabled: boolean }`.
  - State: `ReadonlyMap<PreviewId, ApprovalVM>` plus derived `readonly ApprovalVM[]` for rendering.
  - Actions: `approve(approvalId)`, `approveWithEdits(approvalId, edited)`, `reject(approvalId, payload)`, `cancel(previewId)`, `setBypass(enabled)`, `setRules(rules)`.
  - Subscriptions: attach to `agent:approval:watch` on mount; remove on unmount.
  - Strict typing: no `any`; validate IPC payloads before updating state.
  - Maintain streaming flags in the VM and disable Apply when streaming is not `ready` (full rendering in Phase 4).

### UI Components
- Directory: `src/components/agent-approvals/`
  - `button-config.ts`: `getApprovalButtons({ preview, status, streaming, bypassEnabled })` → readonly array of typed descriptors (`kind: 'primary' | 'secondary' | 'tertiary'`, `label`, `onSelect`, `disabled`).
  - `AgentApprovalCard.tsx`: renders header (tool icon, path/workspace), body (basic preview info or JSON fallback), feedback textarea, and action buttons. Use accessible labels/roles and manage focus on updates.
  - `AgentApprovalList.tsx`: renders list of cards; use simple list for MVP; virtualise later if necessary.
  - `AgentApprovalEmptyState.tsx` and `agent-approvals.css` for styling.
  - MVP preview body: show summary, path(s), bytes/tokens, and a JSON fallback of `detail`. Rich diff/terminal rendering can wait for Phase 4.

### Agent Panel Integration
- File: `src/components/agent-panel.tsx`
  - Read `AGENT_APPROVAL_V2` (e.g., `agent.approvals.v2Enabled`) from prefs via `/prefs/get`.
  - When enabled: render `AgentApprovalList` between `AgentNotifications` and `AgentMessages` and pass `sessionId`.
  - Migrate the header toggle label to “Bypass approvals” and wire to `setBypass` from the hook.
  - Ensure `AgentToolCalls` becomes a pure log (remove auto-approve side effects when the flag is enabled).

### Coding Standards
- Follow `TYPESCRIPT.md`: readonly props/state, discriminated unions for statuses, no `any`, guard IPC payloads.
- Respect UI naming/style and a11y best practices (labels, roles, focus management).

---

## Implementation Steps
1. Extend `preload.ts` allowlist and helper wrappers for approval IPC.
2. Implement `useAgentApprovals` hook with typed state, actions, and subscriptions.
3. Create `agent-approvals/` components and minimal CSS.
4. Integrate into `AgentPanel` behind the `AGENT_APPROVAL_V2` flag; rename the header toggle.
5. Gate existing auto-approve behaviour in `AgentToolCalls.tsx` when the feature flag is on (becomes log-only) — do not regress legacy flow when flag is off.
6. Add documentation snippets to `AGENTS.md` for how to use the new UI.

---

## Effort & Risks
- Effort: Medium–Large (hook, components, preload updates, panel integration).
- Risks:
  - Subscription cleanup: ensure `preload.removeListener` is used to avoid leaks.
  - State divergence on IPC failures: use optimistic update with rollback + user toasts.
  - Large approval counts: add a virtualization threshold for `AgentApprovalList` if pending > N.

---

## Testing & Validation (per `TESTING.md`)
- Add RTL tests:
  - `src/__tests__/agent-approvals-hook.test.tsx`: hook initial load, broadcast updates, and action calls (mock preload once per file).
  - `src/__tests__/agent-approval-card.test.tsx`: renders metadata, disables buttons while streaming, sends feedback, and calls actions.
  - `src/__tests__/agent-approval-list-integration.test.tsx`: toggling feature flag, showing empty state, list rendering.
- Ensure ≥2 assertions per test; use accessible queries; avoid brittle snapshots.

---

## Dependencies
- Phase 1–2 complete: types, DB, service, and IPC available.

---

## Acceptance Checklist
- [ ] Preload exposes typed IPC wrappers and cleans up listeners
- [ ] `useAgentApprovals` manages state and actions correctly
- [ ] Card/list components render approvals and dispatch actions
- [ ] Agent panel integrates approvals behind feature flag
- [ ] RTL tests pass with good assertion density

---

## Scaffold Code Snippets (for rapid implementation)

The snippets below help wire preload wrappers, the hook, and basic components.

### A) Preload wrappers (`src/main/preload.ts`) — example additions

```ts
// Inside contextBridge.exposeInMainWorld('electron', { ipcRenderer: { ... } })
// Add typed helpers for approvals
invokeApprovalList: async (payload: { sessionId: string }) => {
  return ipcRenderer.invoke('agent:approval:list', ensureSerializable(payload));
},
onApprovalNew: (handler: (payload: unknown) => void) => ipcRenderer.on('agent:approval:new', (_e, p) => handler(ensureSerializable(p))),
onApprovalUpdate: (handler: (payload: unknown) => void) => ipcRenderer.on('agent:approval:update', (_e, p) => handler(ensureSerializable(p))),
removeListener: (channel: string, fn: (...args: unknown[]) => void) => ipcRenderer.removeListener(channel, fn as any),
```

### B) `src/hooks/use-agent-approvals.ts` (skeleton)

```ts
import { useCallback, useEffect, useMemo, useReducer } from 'react';

type ApprovalVM = Readonly<{ id: string; previewId: string; sessionId: string; status: string; summary: string; tool: string; action: string; streaming?: 'pending'|'running'|'ready'|'failed'; }>;

type State = ReadonlyMap<string, ApprovalVM>;
type Action = { type: 'reset'; items: ApprovalVM[] } | { type: 'upsert'; item: ApprovalVM } | { type: 'remove'; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset': {
      const m = new Map<string, ApprovalVM>();
      for (const it of action.items) m.set(it.id, it);
      return m;
    }
    case 'upsert': {
      const m = new Map(state);
      m.set(action.item.id, action.item);
      return m;
    }
    case 'remove': {
      const m = new Map(state);
      m.delete(action.id);
      return m;
    }
  }
}

export default function useAgentApprovals(sessionId: string | null, enabled: boolean) {
  const [map, dispatch] = useReducer(reducer, new Map());

  useEffect(() => {
    if (!enabled || !sessionId) return;
    (async () => {
      const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:approval:list', { sessionId });
      const items = Array.isArray(res?.data?.approvals) ? res.data.approvals : [];
      dispatch({ type: 'reset', items });
    })();
    const onNew = (p: any) => { if (p?.approval) dispatch({ type: 'upsert', item: p.approval as ApprovalVM }); };
    const onUpdate = (p: any) => { if (p?.approval) dispatch({ type: 'upsert', item: p.approval as ApprovalVM }); };
    (window as any).electron?.ipcRenderer?.on?.('agent:approval:new', onNew);
    (window as any).electron?.ipcRenderer?.on?.('agent:approval:update', onUpdate);
    return () => {
      (window as any).electron?.ipcRenderer?.removeListener?.('agent:approval:new', onNew);
      (window as any).electron?.ipcRenderer?.removeListener?.('agent:approval:update', onUpdate);
    };
  }, [sessionId, enabled]);

  const list = useMemo(() => Array.from(map.values()), [map]);

  const approve = useCallback(async (approvalId: string) => {
    await (window as any).electron?.ipcRenderer?.invoke?.('agent:approval:apply', { approvalId });
  }, []);

  const reject = useCallback(async (approvalId: string, feedbackText?: string) => {
    await (window as any).electron?.ipcRenderer?.invoke?.('agent:approval:reject', { approvalId, feedbackText });
  }, []);

  return { approvals: list, approve, reject } as const;
}
```

### C) Minimal components (`src/components/agent-approvals/AgentApprovalCard.tsx`)

```tsx
import React from 'react';

type Props = { approval: { id: string; summary: string; tool: string; action: string; status: string }; onApprove: () => void; onReject: () => void; };

const AgentApprovalCard: React.FC<Props> = ({ approval, onApprove, onReject }) => {
  return (
    <article aria-label="Approval card" style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <header style={{ fontWeight: 600 }}>{approval.tool} · {approval.action}</header>
      <div style={{ margin: '6px 0' }}>{approval.summary}</div>
      <footer style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={onApprove} aria-label="Approve and apply">Approve</button>
        <button className="secondary" onClick={onReject} aria-label="Reject">Reject</button>
      </footer>
    </article>
  );
};

export default AgentApprovalCard;
```
