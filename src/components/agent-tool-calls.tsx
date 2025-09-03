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

export default function AgentToolCalls({ message }: AgentToolCallsProps) {
  const invocations = getToolInvocationsFromMessage(message);
  const [open, setOpen] = useState<boolean>(false);
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
