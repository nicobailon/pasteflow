import { extname } from "../file-ops/path";
import type { AgentAttachment, UsageRow } from "../types/agent-types";
import { TOKEN_COUNTING } from "@constants";

// Extract a human-readable string from a UI message produced by @ai-sdk/react streams
export function extractVisibleTextFromMessage(m: unknown): string {
  try {
    if (!m || typeof m !== "object") return "";
    const msg = m as { role?: unknown; parts?: unknown; content?: unknown };
    const parts = Array.isArray(msg.parts) ? (msg.parts as ReadonlyArray<{ type?: unknown; text?: unknown }>) : null;
    if (parts) {
      const collect = (types: readonly string[]) => parts
        .filter((p) => typeof p?.type === "string" && types.includes(String(p.type)) && typeof p?.text === "string")
        .map((p) => String(p.text))
        .join("");

      const outText = collect(["output_text", "output-text", "message", "text"]);
      if (outText && outText.trim().length > 0) return outText;

      // If assistant message has no user-visible text yet (e.g., only reasoning/step parts), render nothing
      if (String(msg.role || "") === "assistant") return "";
    }
    if (typeof msg.content === "string") return msg.content;
    return "";
  } catch {
    return "";
  }
}

export function buildDynamicFromAttachments(pending: ReadonlyMap<string, AgentAttachment>): { readonly files: ReadonlyArray<{ readonly path: string; readonly lines: { readonly start: number; readonly end: number } | null; readonly tokenCount?: number }>; } {
  const files = [...pending.values()].map((v) => ({ path: v.path, lines: v.lines ?? null, tokenCount: v.tokenCount }));
  return { files } as const;
}

export function buildInitialSummaryMessage(envelope: unknown): string {
  try {
    const e = envelope as { initial?: unknown; workspace?: unknown };
    const i = (e && typeof e === "object" && (e as any).initial) ? (e as any).initial : undefined;
    const ws = (e && typeof e === "object" && typeof (e as any).workspace === "string") ? (e as any).workspace : "(unknown)";
    const files = Array.isArray((i as any)?.files) ? ((i as any).files as ReadonlyArray<any>) : [];
    const prompts = (i as any)?.prompts as { system?: unknown; roles?: unknown; instructions?: unknown } | undefined;
    const totalTokens = typeof (i as any)?.metadata?.totalTokens === "number" ? (i as any).metadata.totalTokens : 0;
    const header = `Initial context from PasteFlow — Workspace: ${ws}`;
    const fList = files.slice(0, 20).map((f: any) => `- ${f.relativePath || f.path}${f?.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : ''}`).join("\n");
    const truncated = files.length > 20 ? `\n(…${files.length - 20} more)` : "";
    const sysCount = Array.isArray(prompts?.system) ? prompts?.system.length : 0;
    const rolesCount = Array.isArray(prompts?.roles) ? prompts?.roles.length : 0;
    const instrCount = Array.isArray(prompts?.instructions) ? prompts?.instructions.length : 0;
    const promptSummary = `System=${sysCount}, Roles=${rolesCount}, Instructions=${instrCount}`;
    return [
      header,
      `Files: ${files.length} (est. tokens: ${totalTokens})`,
      fList || "(none)",
      truncated,
      `Prompts: ${promptSummary}`,
    ].filter(Boolean).join("\n");
  } catch {
    return "Initial context received.";
  }
}

export function detectLanguageFromPath(path: string): string {
  const ext = extname(path) || "";
  const lang = ext.startsWith(".") ? ext.slice(1) : ext;
  return (lang || "text").toLowerCase();
}

export function condenseUserMessageForDisplay(text: string): string {
  try {
    const pattern = /File:\s*(.+?)\n```([\w-]*)\n([\S\s]*?)\n```/g;
    return text.replace(pattern, (_m, p1: string, _lang: string, body: string) => {
      const lines = body === "" ? 0 : body.split(/\r?\n/).length;
      return `File: ${p1}\n[File content: ${lines} lines]`;
    });
  } catch {
    return text;
  }
}

export function formatLatency(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

// Very rough cost hint (optional). Extend map as needed.
export function estimateCostUSD(modelId: string | null, u?: Partial<UsageRow> | null): string | null {
  if (!u) return null;
  const i = u.input_tokens ?? 0;
  const o = u.output_tokens ?? 0;
  const t = (typeof u.total_tokens === 'number') ? u.total_tokens : (i + o);
  if (!t) return null;
  const m = (modelId || '').toLowerCase();
  const perK: { in: number; out: number } = m.includes('gpt-4o-mini') ? { in: 0.0005, out: 0.0015 } :
    (m.includes('gpt-5') ? { in: 0.005, out: 0.015 } :
    m.includes('haiku') ? { in: 0.0008, out: 0.0024 } : { in: 0.001, out: 0.003 });
  const cost = (i / 1000) * perK.in + (o / 1000) * perK.out;
  return `$${cost.toFixed(cost < 0.01 ? 3 : 2)}`;
}

export function estimateTokensForText(text: string): number {
  return text ? Math.ceil(text.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
}

