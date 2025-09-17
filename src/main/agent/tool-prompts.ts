/**
 * Modular, per-tool guidance snippets appended to the system prompt.
 * Keep these concise; the goal is to teach how/when to use each tool.
 */
export function getToolPrompts(): Record<string, string> {
  return {
    file:
      "Use file.read to load file contents (optionally by lines). Use file.info for size/mtime and file.list to enumerate a directory. Avoid re-embedding large files in full; prefer targeted ranges.",
    search:
      "Use search.code for code/regex searches and search.files for filename matches. Prefer searching within the workspace folder relevant to the task.",
    edit:
      "Use edit.diff/block/multi to propose changes. Default to previewing a unified diff. Applying changes may require approval and write permissions; avoid destructive edits.",
    context:
      "Use context.summary to understand current initial/dynamic context, context.expand to fetch specific file ranges with token counts, and context.search to locate snippets.",
    terminal:
      "Use terminal.start/interact/output/list/kill to run commands when necessary. Risky commands may require approval. Avoid destructive commands and be explicit with flags.",
  } as const as Record<string, string>;
}
