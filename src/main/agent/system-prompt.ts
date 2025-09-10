import type { AgentContextEnvelope } from "../../shared-types/agent-context";
import { getToolPrompts } from "./tool-prompts";

export interface CombinedContext {
  initial?: AgentContextEnvelope["initial"];
  dynamic: AgentContextEnvelope["dynamic"];
  workspace?: string | null;
}

export type ToolCatalogEntry = { name: string; description: string; actions?: ReadonlyArray<{ name: string; required: string[]; optional?: string[]; gatedBy?: string }>; };

function toRel(path: string, root?: string | null): string {
  try {
    if (!root) return path;
    // Avoid leaking absolute paths in listings
    const nodePath = require("node:path") as typeof import("node:path");
    const rel = nodePath.relative(root, path);
    return rel && !rel.startsWith("..") ? rel : path;
  } catch {
    return path;
  }
}

export function buildSystemPrompt(
  ctx: CombinedContext,
  toolsCatalog?: ReadonlyArray<ToolCatalogEntry>,
  opts?: { enabledTools?: ReadonlySet<string> }
): string {
  const ws = ctx.workspace || "(unknown)";

  const iFiles = ctx.initial?.files ?? [];
  const dFiles = ctx.dynamic?.files ?? [];

  const iPrompts = ctx.initial?.prompts;
  const user = ctx.initial?.user;
  const iTotalTokens = ctx.initial?.metadata?.totalTokens ?? 0;

  const list = (files: { path: string; lines?: { start: number; end: number } | null; relativePath?: string }[]) => {
    return files
      .slice(0, 50)
      .map((f) => `  - ${f.relativePath || toRel(f.path, ctx.workspace)}${f.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : ""}`)
      .join("\n");
  };

  const truncatedNote = (files: unknown[]) => (files.length > 50 ? `\n  (…${files.length - 50} more)` : "");

  const enabled = (opts?.enabledTools && opts.enabledTools.size > 0)
    ? new Set(Array.from(opts.enabledTools))
    : null;

  const visibleCatalog = Array.isArray(toolsCatalog)
    ? (enabled ? toolsCatalog.filter((t) => enabled.has(t.name)) : toolsCatalog)
    : [];

  const toolPrompts = getToolPrompts();
  const parts = [
    "You are an AI coding assistant integrated with PasteFlow.",
    `\nWorkspace: ${ws}`,
    "",
    "Initial Context:",
    `- Files: ${iFiles.length}`,
    `- Tokens (prompts + user est.): ${iTotalTokens}`,
    iFiles.length ? list(iFiles) + truncatedNote(iFiles) : "  - None",
    "",
    "Dynamic Context:",
    `- Files: ${dFiles.length}`,
    dFiles.length ? list(dFiles) + truncatedNote(dFiles) : "  - None",
    "",
    "Prompts Summary:",
    `- System: ${iPrompts?.system?.length ?? 0}` + (iPrompts?.system?.length ? ` (${(iPrompts.system || []).map((p) => p.name).join(", ")})` : ""),
    `- Roles: ${iPrompts?.roles?.length ?? 0}` + (iPrompts?.roles?.length ? ` (${(iPrompts.roles || []).map((p) => p.name).join(", ")})` : ""),
    `- Instructions: ${iPrompts?.instructions?.length ?? 0}` + (iPrompts?.instructions?.length ? ` (${(iPrompts.instructions || []).map((p) => p.name).join(", ")})` : ""),
    `- User text present: ${user?.present ? "yes" : "no"}` + (typeof user?.tokenCount === "number" ? ` (~${user.tokenCount} tokens)` : ""),
    "",
    // Tools catalog (optional; filtered to enabled tools if provided)
    ...(Array.isArray(visibleCatalog) && visibleCatalog.length > 0 ? [
      "Tools available:",
      ...visibleCatalog.map((t) => `- ${t.name}: ${t.description}`),
      "",
    ] : []),
    // Tool-specific guidance (modular)
    ...(Array.isArray(visibleCatalog) && visibleCatalog.length > 0 ? [
      "Tools Guidance:",
      ...visibleCatalog.map((t) => {
        const p = toolPrompts[t.name] || "Use this tool when it reduces work vs. manual steps.";
        return `- ${t.name}: ${p}`;
      }),
      "",
    ] : []),
    "Guidance:",
    "- Use this summary to orient; full file contents may be embedded in user messages.",
    "- You may call tools as needed. If the user asks about available tools, list only enabled tools shown above.",
    "- Do not re-embed entire files in the system prompt.",
  ];

  return parts.filter(Boolean).join("\n");
}
