import { createClient, discover, formatAsTable, handleAxiosError, printJsonOrText } from "../client";
import { ensureAbsolutePath, parseLineRanges } from "../util/parse";

export function attachSelectCommand(root: any): void {
  const cmd = root.command("select").description("Manage selected files and line ranges");

  // select add --path <abs> [--lines 10-20,30,40-50]
  cmd
    .command("add")
    .requiredOption("--path <abs>", "Absolute file path")
    .option("--lines <spec>", "Comma-separated line ranges (e.g., 10-20,30,40-50)")
    .description("Add a file (whole-file or ranges) to the selection")
    .action(async (opts: { path: string; lines?: string }) => {
      const flags = root.opts() as any;
      try {
        const abs = ensureAbsolutePath(String(opts.path));
        const ranges = parseLineRanges(opts.lines);

        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/files/select", {
          items: [
            {
              path: abs,
              lines: ranges,
            },
          ],
        });

        const ok = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok }, flags);
          process.exit(0);
        }
         
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (error: unknown) {
        const e = error as any;
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required" || e.message?.startsWith("Invalid line"))) {
           
          console.error(`VALIDATION_ERROR: ${e.message}`);
          process.exit(2);
        }
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
           
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });

  // select remove --path <abs> [--lines ...]
  cmd
    .command("remove")
    .requiredOption("--path <abs>", "Absolute file path")
    .option("--lines <spec>", "Comma-separated line ranges (omit to remove entire file)")
    .description("Remove a file or specific ranges from the selection")
    .action(async (opts: { path: string; lines?: string }) => {
      const flags = root.opts() as any;
      try {
        const abs = ensureAbsolutePath(String(opts.path));
        const ranges = parseLineRanges(opts.lines);

        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/files/deselect", {
          items: [
            {
              path: abs,
              lines: ranges,
            },
          ],
        });

        const ok = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok }, flags);
          process.exit(0);
        }
         
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (error: unknown) {
        const e = error as any;
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required" || e.message?.startsWith("Invalid line"))) {
           
          console.error(`VALIDATION_ERROR: ${e.message}`);
          process.exit(2);
        }
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
           
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });

  // select clear
  cmd
    .command("clear")
    .description("Clear all selected files")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/files/clear", {});
        const ok = (res.data?.data ?? res.data) as boolean;

        if (flags.json) {
          printJsonOrText({ ok }, flags);
          process.exit(0);
        }
         
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (error) {
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
           
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });

  // select list
  cmd
    .command("list")
    .description("List selected files and ranges")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/files/selected");
        const rows = (res.data?.data ?? res.data) as { path: string; lines?: { start: number; end: number }[] }[];

        if (flags.json) {
          printJsonOrText(rows, flags);
          process.exit(0);
        }

        if (rows.length === 0) {
           
          console.log("No files selected");
          process.exit(0);
        }

        const fmt = (lines?: { start: number; end: number }[]) => {
          if (!lines || lines.length === 0) return "(all)";
          return lines.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
        };

        const table = formatAsTable(
          rows.map((r) => ({ path: r.path, ranges: fmt(r.lines) })),
          [
            { key: "path", header: "Path" },
            { key: "ranges", header: "Ranges" },
          ]
        );
         
        console.log(table);
        process.exit(0);
      } catch (error) {
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
           
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });

  // select tokens — show per-item token counts and totals
  cmd
    .command("tokens")
    .description("Show token counts for selected files, prompts and instructions")
    .option("--max-files <n>", "Maximum number of files to include", (v: string) => parseInt(String(v), 10))
    .option("--max-bytes <n>", "Maximum total bytes to include", (v: string) => parseInt(String(v), 10))
    .option("--no-include-instructions", "Exclude instructions from totals")
    .option("--no-include-prompts", "Exclude prompts from totals")
    .option("--summary-only", "Print only totals")
    .option("--relative", "Show relative paths")
    .action(async (opts: { maxFiles?: number; maxBytes?: number; includeInstructions?: boolean; includePrompts?: boolean; summaryOnly?: boolean; relative?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);

        const params: Record<string, string> = {};
        if (typeof opts.maxFiles === 'number' && Number.isFinite(opts.maxFiles) && opts.maxFiles > 0) params.maxFiles = String(opts.maxFiles);
        if (typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0) params.maxBytes = String(opts.maxBytes);
        if (opts.includePrompts === false) params.includePrompts = 'false';
        if (opts.includeInstructions === false) params.includeInstructions = 'false';
        if (opts.relative) params.relativePaths = 'true';

        const qs = new URLSearchParams(params).toString();
        const url = qs ? `/api/v1/selection/tokens?${qs}` : "/api/v1/selection/tokens";
        const res = await client.get(url);
        const data = (res.data?.data ?? res.data) as {
          backend: string;
          files: Array<{ path: string; relativePath?: string; ranges: { start: number; end: number }[] | null; bytes: number; tokenCount: number; partial: boolean; skipped: boolean; reason: string | null }>;
          prompts: { system: { id: string; name: string; tokenCount: number }[]; roles: { id: string; name: string; tokenCount: number }[]; instructions: { id: string; name: string; tokenCount: number }[]; user: { present: boolean; tokenCount: number } };
          totals: { files: number; prompts: number; all: number };
        };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        if (opts.summaryOnly) {
          console.log(`Files: ${data.totals.files}, Prompts: ${data.totals.prompts}, All: ${data.totals.all} (backend: ${data.backend})`);
          process.exit(0);
        }

        const rows: Array<{ type: string; path: string; ranges: string; tokens: string; note: string }> = [];
        const fmtRanges = (ranges: { start: number; end: number }[] | null | undefined) => {
          if (!ranges || ranges.length === 0) return "(all)";
          return ranges.map(r => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
        };
        // Files
        for (const f of data.files) {
          const showPath = opts.relative && f.relativePath ? f.relativePath : f.path;
          const note = f.skipped ? `skipped: ${f.reason || ''}` : (f.partial ? 'selected lines' : '');
          rows.push({ type: 'File', path: showPath, ranges: fmtRanges(f.ranges), tokens: String(f.tokenCount), note });
        }
        // Prompts
        for (const p of data.prompts.system) {
          rows.push({ type: 'System', path: p.name, ranges: '-', tokens: String(p.tokenCount), note: '' });
        }
        for (const p of data.prompts.roles) {
          rows.push({ type: 'Role', path: p.name, ranges: '-', tokens: String(p.tokenCount), note: '' });
        }
        for (const i of data.prompts.instructions) {
          rows.push({ type: 'Instruction', path: i.name, ranges: '-', tokens: String(i.tokenCount), note: '' });
        }
        if (data.prompts.user.present) {
          rows.push({ type: 'User', path: '(user instructions)', ranges: '-', tokens: String(data.prompts.user.tokenCount), note: '' });
        }

        if (rows.length > 0) {
          const table = formatAsTable(rows, [
            { key: 'type', header: 'Type' },
            { key: 'path', header: 'Path/Name' },
            { key: 'ranges', header: 'Ranges' },
            { key: 'tokens', header: 'Tokens' },
            { key: 'note', header: 'Note' },
          ]);
          console.log(table);
        }
        console.log(`\nTotals — Files: ${data.totals.files}, Prompts: ${data.totals.prompts}, All: ${data.totals.all} (backend: ${data.backend})`);
        process.exit(0);
      } catch (error) {
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });
}
