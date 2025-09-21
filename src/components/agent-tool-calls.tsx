import { useState } from "react";

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

function summarizeInvocation(invocation: ToolInvocation): string {
  const name = (invocation.toolName || invocation.name || "tool").toLowerCase();
  if (name === "search") {
    try {
      const result = invocation.result as any;
      const parts: string[] = ["search"];
      if (typeof result?.totalMatches === "number") parts.push(String(result.totalMatches));
      if (result?.truncated) parts.push("truncated");
      return parts.join(": ");
    } catch {
      // ignore summary failures
    }
  }
  return invocation.toolName || invocation.name || "tool";
}

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
    if (out.length > 0) return out;
  }
  return [];
}

export default function AgentToolCalls({ message, sessionId, skipApprovals = false, onToggleSkipApprovals }: AgentToolCallsProps) {
  const invocations = getToolInvocationsFromMessage(message);
  const hasInvocations = invocations.length > 0;
  const [open, setOpen] = useState<boolean>(false);
  const [turnSkip, setTurnSkip] = useState<Record<number, boolean>>({});

  const summary = invocations.map((invocation) => summarizeInvocation(invocation)).join(", ");

  if (!hasInvocations) return null;

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
              {i.args !== undefined && (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{safeJson(i.args)}</pre>
              )}
              {i.result !== undefined && (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{safeJson(i.result)}</pre>
              )}
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(turnSkip[idx] || skipApprovals)}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setTurnSkip((prev) => ({ ...prev, [idx]: v }));
                      onToggleSkipApprovals?.(v);
                    }}
                  />
                  <span style={{ fontSize: 12 }}>Bypass approvals for this turn</span>
                </label>
              </div>
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
