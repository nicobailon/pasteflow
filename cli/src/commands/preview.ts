import { createClient, discover, handleAxiosError, parseAtFile, printJsonOrText } from "../client";
import fs from "node:fs";
import path from "node:path";

type PreviewState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export function attachPreviewCommand(root: any): void {
  const cmd = root.command("preview").description("Preview generation (async)");

  // preview start [...]
  cmd
    .command("start")
    .option("--include-trees", "Include file trees in preview", false)
    .option("--max-files <n>", "Max number of files to include", (v) => Number.parseInt(v, 10))
    .option("--max-bytes <n>", "Max total bytes to include", (v) => Number.parseInt(v, 10))
    .option("--prompt <textOr@file>", "Prompt text or @file with prompt content")
    .option("--follow", "Poll status until terminal; fetch content on success", false)
    .option("--wait-ms <ms>", "Max total time to wait when --follow is set (default 180000)", (v) => Number.parseInt(v, 10))
    .option("--out <file>", "Write preview content to a local file (when --follow)", undefined)
    .option("--overwrite", "Overwrite output file if it exists", false)
    .description("Start a preview job")
    .action(async (opts: { includeTrees?: boolean; maxFiles?: number; maxBytes?: number; prompt?: string; follow?: boolean; waitMs?: number; out?: string; overwrite?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const prompt = parseAtFile(opts.prompt);
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/preview/start", {
          includeTrees: Boolean(opts.includeTrees) || undefined,
          maxFiles: Number.isFinite(opts.maxFiles) && (opts.maxFiles as number) > 0 ? Number(opts.maxFiles) : undefined,
          maxBytes: Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0 ? Number(opts.maxBytes) : undefined,
          prompt: typeof prompt === "string" ? prompt : undefined,
        });
        const data = (res.data?.data ?? res.data) as { id: string };

        if (!opts.follow) {
          if (flags.json) {
            printJsonOrText({ id: data.id }, flags);
            process.exit(0);
          }
          // eslint-disable-next-line no-console
          console.log(data.id);
          process.exit(0);
        }

        const waitMs = Number.isFinite(opts.waitMs) && (opts.waitMs as number) > 0 ? Number(opts.waitMs) : 180000;
        const result = await followUntilTerminal(client, data.id, waitMs, flags);

        if (result.state === "SUCCEEDED") {
          // Fetch content
          const contentRes = await client.get(`/api/v1/preview/content/${encodeURIComponent(data.id)}`);
          const contentData = (contentRes.data?.data ?? contentRes.data) as { id: string; content: string; tokenCount: number; fileCount: number };
          if (opts.out) {
            const { bytes } = await writeLocalFile(String(opts.out), contentData.content, Boolean(opts.overwrite));
            if (flags.json) {
              printJsonOrText({ id: data.id, outputPath: String(opts.out), bytes, tokenCount: contentData.tokenCount, fileCount: contentData.fileCount }, flags);
              process.exit(0);
            }
            // eslint-disable-next-line no-console
            console.log(`Wrote ${bytes} bytes to ${String(opts.out)} (files: ${contentData.fileCount}, tokens: ${contentData.tokenCount})`);
            process.exit(0);
          }
          if (flags.json) {
            printJsonOrText({ id: data.id, ...contentData }, flags);
            process.exit(0);
          }
          if (flags.raw) {
            // eslint-disable-next-line no-console
            console.log(contentData.content);
            process.exit(0);
          }
          const lines: string[] = [];
          lines.push(`Files: ${contentData.fileCount}`);
          lines.push(`Tokens: ${contentData.tokenCount}`);
          lines.push("");
          // eslint-disable-next-line no-console
          console.log(lines.join("\n") + contentData.content);
          process.exit(0);
        } else if (result.state === "CANCELLED") {
          if (flags.json) {
            printJsonOrText({ id: data.id, state: "CANCELLED" }, flags);
          } else {
            // eslint-disable-next-line no-console
            console.error("CANCELLED");
          }
          process.exit(1);
        } else {
          // FAILED
          if (flags.json) {
            printJsonOrText({ id: data.id, state: "FAILED", error: result.error || { code: "INTERNAL_ERROR", message: "Preview failed" } }, flags);
          } else {
            // eslint-disable-next-line no-console
            console.error(`FAILED: ${result.error?.message || "Preview failed"}`);
          }
          process.exit(1);
        }
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

  // preview status <id> [--watch] [--interval-ms N]
  cmd
    .command("status")
    .argument("<id>", "Preview job id")
    .option("--watch", "Poll status until terminal state", false)
    .option("--interval-ms <n>", "Polling interval (initial) in ms", (v) => Number.parseInt(v, 10))
    .description("Get preview job status")
    .action(async (id: string, opts: { watch?: boolean; intervalMs?: number }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        if (!opts.watch) {
          const res = await client.get(`/api/v1/preview/status/${encodeURIComponent(id)}`);
          const data = (res.data?.data ?? res.data) as any;
          if (flags.json) {
            printJsonOrText(data, flags);
          } else {
            // eslint-disable-next-line no-console
            console.log(`${data.state}${data.error ? ` — ${data.error.code}: ${data.error.message}` : ""}`);
          }
          process.exit(0);
        }
        // watch mode
        const start = Date.now();
        let delay = Number.isFinite(opts.intervalMs) && (opts.intervalMs as number) > 0 ? Number(opts.intervalMs) : 250;
        const maxDelay = 3000;
        while (true) {
          const res = await client.get(`/api/v1/preview/status/${encodeURIComponent(id)}`);
          const data = (res.data?.data ?? res.data) as any;
          if (data.state === "SUCCEEDED" || data.state === "FAILED" || data.state === "CANCELLED") {
            if (flags.json) {
              printJsonOrText(data, flags);
            } else {
              // eslint-disable-next-line no-console
              console.log(`${data.state}${data.error ? ` — ${data.error.code}: ${data.error.message}` : ""}`);
            }
            process.exit(data.state === "SUCCEEDED" ? 0 : 1);
          }
          await sleep(delay);
          delay = Math.min(Math.floor(delay * 1.5), maxDelay);
          if (Date.now() - start > 180000) {
            // eslint-disable-next-line no-console
            console.error("Watch timeout exceeded (180000ms)");
            process.exit(1);
          }
        }
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

  // preview content <id> [--out <file>] [--overwrite] [--raw]
  cmd
    .command("content")
    .argument("<id>", "Preview job id")
    .option("--out <file>", "Write preview content to a local file")
    .option("--overwrite", "Overwrite output file if it exists", false)
    .description("Fetch preview content for a completed job")
    .action(async (id: string, opts: { out?: string; overwrite?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get(`/api/v1/preview/content/${encodeURIComponent(id)}`);
        const data = (res.data?.data ?? res.data) as { id: string; content: string; tokenCount: number; fileCount: number };
        if (opts.out) {
          const { bytes } = await writeLocalFile(String(opts.out), data.content, Boolean(opts.overwrite));
          if (flags.json) {
            printJsonOrText({ id, outputPath: String(opts.out), bytes, tokenCount: data.tokenCount, fileCount: data.fileCount }, flags);
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

  // preview cancel <id>
  cmd
    .command("cancel")
    .argument("<id>", "Preview job id")
    .description("Cancel a running preview job")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post(`/api/v1/preview/cancel/${encodeURIComponent(id)}`, {});
        const ok = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok }, flags);
        } else {
          // eslint-disable-next-line no-console
          console.log(ok ? "true" : "false");
        }
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

async function followUntilTerminal(client: any, id: string, waitMs: number, flags: any): Promise<{ state: PreviewState; error?: { code: string; message: string } }> {
  const start = Date.now();
  let delay = 250;
  const maxDelay = 3000;
  while (true) {
    const res = await client.get(`/api/v1/preview/status/${encodeURIComponent(id)}`);
  	const data = (res.data?.data ?? res.data) as any;
    if (data.state === "SUCCEEDED" || data.state === "FAILED" || data.state === "CANCELLED") {
      return { state: data.state, error: data.error };
    }
    await sleep(delay);
    delay = Math.min(Math.floor(delay * 1.5), maxDelay);
    if (Date.now() - start > waitMs) {
      // emulate timeout result; server may still be running
      return { state: "FAILED", error: { code: "PREVIEW_TIMEOUT", message: "Follow timeout exceeded" } };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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