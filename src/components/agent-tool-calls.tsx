import { useEffect, useState } from "react";

type ToolInvocation = {
  toolName?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  state?: string;
};

type AgentToolCallsProps = {
  message: any;
  sessionId?: string | null;
  skipApprovals?: boolean;
  onToggleSkipApprovals?: (value: boolean) => void;
};

function getToolInvocationsFromMessage(message: any): ToolInvocation[] {
  // Try common shapes produced by Vercel AI SDK UI stream
  if (Array.isArray(message?.toolInvocations)) return message.toolInvocations as ToolInvocation[];
  if (Array.isArray(message?.tool_calls)) return message.tool_calls as ToolInvocation[];
  // Some SDKs embed tools within parts
  if (Array.isArray(message?.parts)) {
    const out: ToolInvocation[] = [];
    for (const p of message.parts) {
      if (p?.type === "tool_invocation" || p?.type === "tool-call") {
        out.push({ toolName: p?.toolName || p?.name, args: p?.args, result: p?.result, state: p?.state });
      }
    }
    if (out.length) return out;
  }
  return [];
}

export default function AgentToolCalls({ message, sessionId, skipApprovals = false, onToggleSkipApprovals }: AgentToolCallsProps) {
  const invocations = getToolInvocationsFromMessage(message);
  const [open, setOpen] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<Record<number, boolean>>({});
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [turnSkip, setTurnSkip] = useState<Record<number, boolean>>({});
  if (!invocations || invocations.length === 0) return null;

  const toSummary = (i: ToolInvocation): string => {
    const name = (i.toolName || i.name || "tool").toLowerCase();
    if (name === "search") {
      try {
        const r = i.result as any;
        const parts: string[] = ["search"];
        if (typeof r?.totalMatches === "number") parts.push(String(r.totalMatches));
        if (r?.truncated) parts.push("truncated");
        return parts.join(": ");
      } catch { /* ignore */ }
    }
    return i.toolName || i.name || "tool";
  };

  const summary = invocations.map((i) => toSummary(i)).join(", ");

  // Auto-approve risky terminal calls when global skip is enabled
  useEffect(() => {
    if (!skipApprovals || !sessionId) return;
    if (!Array.isArray(invocations)) return;
    // Find first pending approval-required terminal call not yet handled
    const idx = invocations.findIndex((i, index) => {
      if (dismissed[index]) return false;
      const name = String(i.toolName || i.name || '').toLowerCase();
      const res = i.result as any;
      return name === 'terminal' && res && typeof res === 'object' && (res.code === 'APPROVAL_REQUIRED' || res?.error === 'APPROVAL_REQUIRED');
    });
    if (idx < 0) return;
    if (busyIdx != null) return;

    const approve = async () => {
      try {
        setBusyIdx(idx);
        const i = invocations[idx];
        const args = { ...(i.args as Record<string, unknown>), skipPermissions: true };
        const payload = { sessionId, tool: 'terminal', args };
        const out = await (window as any).electron?.ipcRenderer?.invoke?.('agent:execute-tool', payload);
        (i as any).result = out?.data ?? out;
      } catch (e) {
        const i = invocations[idx];
        (i as any).result = { type: 'error', message: (e as Error)?.message || 'Failed to execute' };
      } finally {
        setBusyIdx(null);
        setDismissed((prev) => ({ ...prev, [idx]: true }));
      }
    };
    void approve();
  }, [skipApprovals, sessionId, invocations, dismissed, busyIdx]);

  return (
    <div style={{ marginTop: 6, border: "1px solid var(--border-color, #ddd)", borderRadius: 4 }}>
      <button
        aria-expanded={open}
        aria-controls="agent-tool-calls-panel"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "6px 8px",
          background: "var(--bg-muted, #fafafa)",
          border: "none",
          cursor: "pointer",
        }}
      >
        Tool calls: {summary}
      </button>
      {open && (
        <div id="agent-tool-calls-panel" style={{ padding: 8 }}>
          {invocations.map((i, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{i.toolName || i.name}</div>
              {typeof i.args !== "undefined" && (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{safeJson(i.args)}</pre>
              )}
              {typeof i.result !== "undefined" && (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{safeJson(i.result)}</pre>
              )}
              {/* Approval UX for terminal tool */}
              {(() => {
                const name = String(i.toolName || i.name || '').toLowerCase();
                const res = i.result as any;
                if (name === 'terminal' && res && typeof res === 'object' && (res.code === 'APPROVAL_REQUIRED' || res?.error === 'APPROVAL_REQUIRED') && !dismissed[idx]) {
                  const usingSkip = Boolean(turnSkip[idx] || skipApprovals);
                  const approve = async () => {
                    if (!sessionId) return;
                    setBusyIdx(idx);
                    try {
                      const args = { ...(i.args as Record<string, unknown>), skipPermissions: true };
                      const payload = { sessionId, tool: 'terminal', args };
                      const out = await (window as any).electron?.ipcRenderer?.invoke?.('agent:execute-tool', payload);
                      // Show result inline after approval
                      (i as any).result = out?.data ?? out;
                    } catch (e) {
                      (i as any).result = { type: 'error', message: (e as Error)?.message || 'Failed to execute' };
                    } finally {
                      setBusyIdx(null);
                      setDismissed((prev) => ({ ...prev, [idx]: true }));
                    }
                  };
                  const deny = () => setDismissed((prev) => ({ ...prev, [idx]: true }));
                  return (
                    <div style={{ marginTop: 6, padding: 8, border: '1px solid var(--border-color, #ddd)', borderRadius: 4, background: '#fff7f7' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>This terminal command requires approval.</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="primary" disabled={busyIdx === idx} onClick={approve}>Approve</button>
                        <button className="secondary" disabled={busyIdx === idx} onClick={deny}>Deny</button>
                        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={usingSkip} onChange={(e) => {
                            const v = e.target.checked;
                            setTurnSkip((prev) => ({ ...prev, [idx]: v }));
                            onToggleSkipApprovals?.(v);
                          }} />
                          <span style={{ fontSize: 12 }}>Skip permissions</span>
                        </label>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
