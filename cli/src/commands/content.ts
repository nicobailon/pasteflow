import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";
import fs from "node:fs";
import path from "node:path";

export function attachContentCommand(root: any): void {
  const cmd = root.command("content").description("Aggregate and export selected content");

  // content get [--out <file>] [--overwrite] [--max-files N] [--max-bytes N] [--raw]
  cmd
    .command("get")
    .option("--out <file>", "Write aggregated content to a local file (client-side)")
    .option("--overwrite", "Overwrite output file if it exists", false)
    .option("--max-files <n>", "Max number of files to include", (v) => Number.parseInt(v, 10))
    .option("--max-bytes <n>", "Max total bytes to include", (v) => Number.parseInt(v, 10))
    .description("Get aggregated content for the current selection")
    .action(async (opts: { out?: string; overwrite?: boolean; maxFiles?: number; maxBytes?: number }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);

        const qs = new URLSearchParams();
        if (Number.isFinite(opts.maxFiles) && (opts.maxFiles as number) > 0) qs.set("maxFiles", String(opts.maxFiles));
        if (Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0) qs.set("maxBytes", String(opts.maxBytes));
        const url = `/api/v1/content${qs.toString() ? `?${qs.toString()}` : ""}`;

        const res = await client.get(url);
        const data = (res.data?.data ?? res.data) as {
          content: string;
          fileCount: number;
          tokenCount: number;
        };

        if (opts.out) {
          const { bytes } = await writeLocalFile(String(opts.out), data.content, Boolean(opts.overwrite));
          if (flags.json) {
            printJsonOrText({ outputPath: String(opts.out), bytes, fileCount: data.fileCount, tokenCount: data.tokenCount }, flags);
            process.exit(0);
          }
          // eslint-disable-next-line no-console
          console.log(`Wrote ${bytes} bytes to ${String(opts.out)} (files: ${data.fileCount}, tokens: ${data.tokenCount})`);
          process.exit(0);
        }

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        if (flags.raw) {
          // eslint-disable-next-line no-console
          console.log(data.content);
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`Files: ${data.fileCount}`);
        lines.push(`Tokens: ${data.tokenCount}`);
        lines.push("");
        // eslint-disable-next-line no-console
        console.log(lines.join("\n") + data.content);
        process.exit(0);
      } catch (err: unknown) {
        const e = err as any;
        if (e?.code === "EEXIST") {
          if (flags.json) {
            printJsonOrText({ error: { code: "CONFLICT", message: "File exists; use --overwrite" } }, flags);
          } else {
            // eslint-disable-next-line no-console
            console.error("CONFLICT: File exists; use --overwrite");
          }
          process.exit(5);
        }
        // Map local filesystem write errors to FILE_SYSTEM_ERROR (exit 1)
        if (e && typeof e === "object" && "code" in (e as any)) {
          const code = (e as any).code;
          if (code === "EACCES" || code === "EISDIR" || code === "ENOTDIR" || code === "EPERM" || code === "EBUSY") {
            if (flags.json) {
              printJsonOrText({ error: { code: "FILE_SYSTEM_ERROR", message: (e as Error).message } }, flags);
            } else {
              // eslint-disable-next-line no-console
              console.error(`FILE_SYSTEM_ERROR: ${(e as Error).message}`);
            }
            process.exit(1);
          }
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

  // content export --out <abs> [--overwrite]
  cmd
    .command("export")
    .requiredOption("--out <abs>", "Server-side output path (must be within workspace allowed paths)")
    .option("--overwrite", "Overwrite if the file exists on server", false)
    .description("Export aggregated content to a file via the server")
    .action(async (opts: { out: string; overwrite?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/content/export", {
          outputPath: String(opts.out),
          overwrite: Boolean(opts.overwrite),
        });
        const data = (res.data?.data ?? res.data) as { outputPath: string; bytes: number };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        // eslint-disable-next-line no-console
        console.log(`Exported ${data.bytes} bytes to ${data.outputPath}`);
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

async function writeLocalFile(filePath: string, data: string, overwrite?: boolean): Promise<{ bytes: number }> {
  const dir = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    const st = await fs.promises.stat(filePath);
    if (st.isFile() && overwrite !== true) {
      const ex: any = new Error("File exists; use --overwrite");
      ex.code = "EEXIST";
      throw ex;
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      if (e?.code === "EEXIST") throw e;
    }
  }
  const bytes = Buffer.byteLength(data, "utf8");
  await fs.promises.writeFile(filePath, data, "utf8");
  return { bytes };
}