import type { DatabaseBridge } from "../db/database-bridge";
import { getToolCatalog } from "./tool-catalog";

export type DbGetter = { getPreference: (k: string) => Promise<unknown> };

/** Preference key builder for per-tool enablement. */
export const toolEnabledPrefKey = (toolName: string): string => `agent.tools.${toolName}.enabled`;

/** Return a stable, ordered list of tool names from the catalog. */
export function listToolNames(): string[] {
  try {
    return getToolCatalog().map((t) => t.name);
  } catch {
    return ["file", "search", "edit", "context", "terminal", "generateFromTemplate"];
  }
}

/** Reads tool enabled flags from preferences. Defaults to true when unset. */
export async function getEnabledToolsSet(db: DbGetter): Promise<Set<string>> {
  const names = listToolNames();
  const out = new Set<string>();
  const vals = await Promise.all(names.map((n) => db.getPreference(toolEnabledPrefKey(n)).catch(() => undefined)));
  for (let i = 0; i < names.length; i++) {
    const v = vals[i];
    const enabled = (typeof v === 'boolean') ? v : true;
    if (enabled) out.add(names[i]);
  }
  return out;
}

/** Returns a record of toolName -> enabled flag (defaulting to true). */
export async function getEnabledToolsRecord(db: DbGetter): Promise<Record<string, boolean>> {
  const names = listToolNames();
  const rec: Record<string, boolean> = {};
  const vals = await Promise.all(names.map((n) => db.getPreference(toolEnabledPrefKey(n)).catch(() => undefined)));
  for (let i = 0; i < names.length; i++) {
    const v = vals[i];
    rec[names[i]] = (typeof v === 'boolean') ? v : true;
  }
  return rec;
}

