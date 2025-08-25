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
        // eslint-disable-next-line no-console
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (err: unknown) {
        const e = err as any;
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required" || e.message?.startsWith("Invalid line"))) {
          // eslint-disable-next-line no-console
          console.error(`VALIDATION_ERROR: ${e.message}`);
          process.exit(2);
        }
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (err: unknown) {
        const e = err as any;
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required" || e.message?.startsWith("Invalid line"))) {
          // eslint-disable-next-line no-console
          console.error(`VALIDATION_ERROR: ${e.message}`);
          process.exit(2);
        }
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.log(ok ? "true" : "false");
        process.exit(0);
      } catch (err) {
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
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
        const rows = (res.data?.data ?? res.data) as Array<{ path: string; lines?: Array<{ start: number; end: number }> }>;

        if (flags.json) {
          printJsonOrText(rows, flags);
          process.exit(0);
        }

        if (!rows.length) {
          // eslint-disable-next-line no-console
          console.log("No files selected");
          process.exit(0);
        }

        const fmt = (lines?: Array<{ start: number; end: number }>) => {
          if (!lines || !lines.length) return "(all)";
          return lines.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(",");
        };

        const table = formatAsTable(
          rows.map((r) => ({ path: r.path, ranges: fmt(r.lines) })),
          [
            { key: "path", header: "Path" },
            { key: "ranges", header: "Ranges" },
          ]
        );
        // eslint-disable-next-line no-console
        console.log(table);
        process.exit(0);
      } catch (err) {
        const mapped = handleAxiosError(err, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) {
          // eslint-disable-next-line no-console
          console.error(mapped.message);
        }
        process.exit(mapped.exitCode);
      }
    });
}