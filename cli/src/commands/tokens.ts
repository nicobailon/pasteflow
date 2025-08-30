import { createClient, discover, handleAxiosError, parseAtFile, printJsonOrText, formatAsTable } from "../client";

export function attachTokensCommand(root: any): void {
  const cmd = root.command("tokens").description("Token counting utilities");

  // tokens count --text <textOr@file>
  cmd
    .command("count")
    .requiredOption("--text <textOr@file>", "Text to count tokens for (string or @file)")
    .description("Count tokens for provided text")
    .action(async (opts: { text: string }) => {
      const flags = root.opts() as any;
      try {
        const input = parseAtFile(opts.text) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/tokens/count", { text: String(input) });
        const data = (res.data?.data ?? res.data) as { count: number; backend?: string };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

         
        const backendSuffix = data.backend ? ` (backend: ${data.backend})` : "";
        console.log(`Tokens: ${data.count}${backendSuffix}`);
        process.exit(0);
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        // Map local @file read errors to VALIDATION_ERROR (exit code 2)
        if (e && (e.code === "ENOENT" || e.code === "EISDIR" || e.code === "EACCES")) {
          if (flags.json) {
            printJsonOrText({ error: { code: "VALIDATION_ERROR", message: e.message } }, flags);
          } else {
             
            console.error(`VALIDATION_ERROR: ${e.message}`);
          }
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

  // tokens backend
  cmd
    .command("backend")
    .description("Show the active token counting backend")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/tokens/backend");
        const data = (res.data?.data ?? res.data) as { backend: string };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

         
        console.log(data.backend);
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

  // tokens selection — alias of `select tokens`
  cmd
    .command("selection")
    .description("Show token counts for current selection (alias of 'select tokens')")
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
