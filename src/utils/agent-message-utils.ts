import { extname } from "../file-ops/path";
import type { AgentAttachment, UsageRow } from "../types/agent-types";
import { TOKEN_COUNTING } from "@constants";

// Extract a human-readable string from a UI message produced by @ai-sdk/react streams
export function extractVisibleTextFromMessage(m: unknown): string {
  try {
    if (!m || typeof m !== "object") return "";
    const msg = m as { role?: unknown; parts?: unknown; content?: unknown };

    // Helper: collect text from an array of content/parts items
    const collectFrom = (arr: ReadonlyArray<any>): string => {
      try {
        const out: string[] = [];
        for (const it of arr) {
          const t = typeof it?.type === 'string' ? String(it.type).toLowerCase() : '';
          // Heuristic: include any item whose type contains 'text' or is known text-bearing
          if ((t && (t.includes('text') || t === 'message' || t === 'output_text' || t === 'output-text')) && typeof it?.text === 'string') {
            out.push(String(it.text));
            continue;
          }
          // Some providers place text under alternate keys
          if (typeof (it as any)?.output_text === 'string') { out.push(String((it as any).output_text)); continue; }
          if (typeof (it as any)?.outputText === 'string') { out.push(String((it as any).outputText)); continue; }
          if (typeof (it as any)?.response_text === 'string') { out.push(String((it as any).response_text)); continue; }
          if (typeof (it as any)?.textDelta === 'string') { out.push(String((it as any).textDelta)); continue; }
          // Some SDKs provide { text: '...' } without a type
          if (!t && typeof it?.text === 'string') {
            out.push(String(it.text));
            continue;
          }
          // Fallback: if item has a nested content string
          if (typeof it?.content === 'string') {
            out.push(String(it.content));
            continue;
          }
          // Handle nested objects with value fields
          if (typeof (it as any)?.value === 'string') { out.push(String((it as any).value)); continue; }
          // Recursively search common containers
          const nested = (it && typeof it === 'object') ? (it as any).content || (it as any).data || (it as any).delta || (it as any).items || (it as any).parts : undefined;
          if (nested && Array.isArray(nested)) {
            const nestedText = collectFrom(nested);
            if (nestedText) out.push(nestedText);
          }
        }
        return out.join("");
      } catch {
        return "";
      }
    };

    // Prefer modern UIMessage shape: content as array
    if (Array.isArray((msg as any).content)) {
      const out = collectFrom((msg as any).content as ReadonlyArray<any>);
      if (out && out.trim().length > 0) return out;
      if (String(msg.role || "") === "assistant") return ""; // assistant with non-visible parts (e.g., reasoning)
    }

    // Legacy/alternate shapes: parts array
    const parts = Array.isArray((msg as any).parts) ? ((msg as any).parts as ReadonlyArray<any>) : null;
    if (parts) {
      const outText = collectFrom(parts);
      if (outText && outText.trim().length > 0) return outText;
      if (String(msg.role || "") === "assistant") return "";
    }

    // Fallbacks
    if (typeof (msg as any).content === "string") return (msg as any).content as string;
    if ((msg as any).content && typeof (msg as any).content === 'object' && typeof (msg as any).content.text === 'string') {
      return String((msg as any).content.text);
    }

    // Deep fallback: search common container keys for text-bearing nodes
    try {
      const keysToScan = new Set(['content', 'parts', 'items', 'children', 'delta', 'data']);
      const seen = new Set<unknown>();
      const out: string[] = [];
      const visit = (val: unknown, parentType?: string) => {
        if (val == null) return;
        if (seen.has(val)) return; seen.add(val);
        if (typeof val === 'string') return; // avoid pulling raw strings without signal
        if (Array.isArray(val)) { for (const v of val) visit(v); return; }
        if (typeof val === 'object') {
          const obj = val as Record<string, unknown>;
          const t = typeof obj.type === 'string' ? String(obj.type).toLowerCase() : parentType;
          // Collect common fields regardless of type — some providers omit a text-y type
          if (typeof obj.text === 'string') out.push(String(obj.text));
          if (typeof obj.content === 'string') out.push(String(obj.content));
          if (typeof (obj as any)?.value === 'string') out.push(String((obj as any).value));
          if (typeof (obj as any)?.output_text === 'string') out.push(String((obj as any).output_text));
          if (typeof (obj as any)?.outputText === 'string') out.push(String((obj as any).outputText));
          if (typeof (obj as any)?.response_text === 'string') out.push(String((obj as any).response_text));
          if (typeof (obj as any)?.textDelta === 'string') out.push(String((obj as any).textDelta));
          if (typeof (obj as any)?.data === 'object' && (obj as any).data) {
            const data = (obj as any).data as Record<string, unknown>;
            if (typeof data.text === 'string') out.push(String(data.text));
            if (typeof data.content === 'string') out.push(String(data.content));
            if (typeof (data as any)?.output_text === 'string') out.push(String((data as any).output_text));
            if (typeof (data as any)?.outputText === 'string') out.push(String((data as any).outputText));
            if (typeof (data as any)?.response_text === 'string') out.push(String((data as any).response_text));
          }
          for (const k of Object.keys(obj)) {
            if (keysToScan.has(k)) visit(obj[k], t);
          }
        }
      };
      visit(msg as any);
      const joined = out.join('');
      if (joined && joined.trim().length > 0) return joined;
    } catch { /* ignore */ }

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
