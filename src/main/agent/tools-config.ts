import { getToolCatalog } from "./tool-catalog";

export type DbGetter = { getPreference: (k: string) => Promise<unknown> };

/** Preference key builder for per-tool enablement. */
export const toolEnabledPrefKey = (toolName: string): string => `agent.tools.${toolName}.enabled`;

/** Return a stable, ordered list of tool names from the catalog. */
export function listToolNames(): string[] {
  try {
    return getToolCatalog().map((t) => t.name);
  } catch {
    return ["file", "search", "edit", "context", "terminal"];
  }
}

/** Reads tool enabled flags from preferences. Defaults to true when unset. */
export async function getEnabledToolsSet(db: DbGetter): Promise<Set<string>> {
  const names = listToolNames();
  const out = new Set<string>();
  const vals = await Promise.all(names.map((n) => db.getPreference(toolEnabledPrefKey(n)).catch(() => null)));
  for (const [i, name] of names.entries()) {
    const v = vals[i];
    const enabled = (typeof v === 'boolean') ? v : true;
    if (enabled) out.add(name);
  }
  return out;
}

/** Returns a record of toolName -> enabled flag (defaulting to true). */
export async function getEnabledToolsRecord(db: DbGetter): Promise<Record<string, boolean>> {
  const names = listToolNames();
  const rec: Record<string, boolean> = {};
  const vals = await Promise.all(names.map((n) => db.getPreference(toolEnabledPrefKey(n)).catch(() => null)));
  for (const [i, name] of names.entries()) {
    const v = vals[i];
    rec[name] = (typeof v === 'boolean') ? v : true;
  }
  return rec;
}
