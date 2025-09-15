import type { AgentContextEnvelope } from "../../shared-types/agent-context";
import type { SystemExecutionContext } from "../../shared-types/system-execution-context";

import { globalSystemContextCache } from "./system-context-cache";

export interface CombinedContext {
  initial?: AgentContextEnvelope["initial"];
  dynamic: AgentContextEnvelope["dynamic"];
  workspace?: string | null;
}

// Removed default summary builder: system prompts are now only the user-defined global/workspace texts

function formatExecutionContext(ctx: SystemExecutionContext): string {
  const shellVersion = ctx.shell.version ? " " + ctx.shell.version : "";
  const lines = [
    `- Working Directory: ${ctx.directory.cwd}`,
    `- Home Directory: ${ctx.directory.home}`,
    `- Platform: ${ctx.platform.os} (${ctx.platform.arch})`,
    `- Shell: ${ctx.shell.name}${shellVersion}`,
    `- Timestamp: ${ctx.timestamp}`,
  ];
  return lines.join("\n");
}

type DbGetter = { getPreference: (k: string) => Promise<unknown> };

type PromptConfig = { text: string; replace: boolean };

async function readSystemPromptsConfig(db: DbGetter): Promise<{ global: PromptConfig; workspace: PromptConfig | null; workspaceId: string | null }>
{
  // Resolve active workspace id (if any)
  let wsId: string | null = null;
  try {
    const raw = await db.getPreference("workspace.active");
    if (typeof raw === "string" && raw.trim()) wsId = raw.trim();
  } catch { /* noop */ }

  // Global
  let gr: unknown; let gt: unknown;
  try { gr = await db.getPreference("agent.systemPrompt.replace"); } catch { /* noop */ }
  try { gt = await db.getPreference("agent.systemPrompt.text"); } catch { /* noop */ }
  const global: PromptConfig = { replace: typeof gr === "boolean" ? gr : false, text: typeof gt === "string" ? gt : "" };

  // Workspace
  let workspace: PromptConfig | null = null;
  if (wsId) {
    let wr: unknown; let wt: unknown;
    try { wr = await db.getPreference(`agent.systemPrompt.replace.${wsId}`); } catch { /* noop */ }
    try { wt = await db.getPreference(`agent.systemPrompt.text.${wsId}`); } catch { /* noop */ }
    const wText = typeof wt === "string" ? wt : "";
    const wReplace = typeof wr === "boolean" ? wr : false;
    if (wText || wReplace) {
      workspace = { replace: wReplace, text: wText };
    }
  }

  return { global, workspace, workspaceId: wsId };
}

export async function composeEffectiveSystemPrompt(
  db: DbGetter,
  _ctx: CombinedContext,
  _opts?: { enabledTools?: ReadonlySet<string> }
): Promise<string> {
  const [{ global, workspace, workspaceId: _workspaceId }, prefExecEnabledGlobal, prefExecEnabledWs] = await Promise.all([
    readSystemPromptsConfig(db),
    (async () => { try { return await db.getPreference('agent.executionContext.enabled'); } catch { return; } })(),
    (async () => { try { return await db.getPreference(`agent.executionContext.enabled.${String((await db.getPreference('workspace.active')) || '')}`); } catch { return; } })(),
  ]);

  // Toggle execution context via preference with env fallback
  const enabledFromPref = (typeof prefExecEnabledWs === 'boolean')
    ? prefExecEnabledWs
    : ((typeof prefExecEnabledGlobal === 'boolean') ? prefExecEnabledGlobal : undefined);
  const disabledFromEnv = (() => {
    try {
      const raw = String(process.env.PF_AGENT_DISABLE_EXECUTION_CONTEXT || "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    } catch { return false; }
  })();
  const enabledFromEnv = !disabledFromEnv;
  const execEnabled = typeof enabledFromPref === "boolean" ? enabledFromPref : enabledFromEnv;
  const executionContext = execEnabled ? await globalSystemContextCache.getContext() : undefined;
  const gText = (global.text || "").trim();
  const wText = (workspace?.text || "").trim();

  // Replace precedence: workspace replaces summary first, then global
  if (workspace?.replace && wText) return appendExecContext(wText, executionContext);
  if (global.replace && gText) return appendExecContext(gText, executionContext);

  // Default composition: Global → Workspace (no automatic summary)
  const parts: string[] = [];
  if (gText) parts.push(gText);
  if (wText) parts.push(wText);
  const base = parts.join("\n\n");
  const effective = appendExecContext(base, executionContext);

  try {
    if (process.env.NODE_ENV === 'development') {
      const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);
      // eslint-disable-next-line no-console
      console.log('[AI][system:effective]', clip(effective));
    }
  } catch { /* noop */ }

  return effective;
}

function appendExecContext(base: string, ctx: SystemExecutionContext | undefined): string {
  if (!ctx) return base;
  const header = "System Execution Context:";
  const body = formatExecutionContext(ctx);
  const block = `${header}\n${body}`;
  return base && base.trim().length > 0 ? `${base}\n\n${block}` : block;
}
