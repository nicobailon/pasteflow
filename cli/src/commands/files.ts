import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";
import { ensureAbsolutePath } from "../util/parse";
import fs from "node:fs";
import path from "node:path";

export function attachFilesCommand(root: any): void {
  const cmd = root.command("files").description("File metadata and content operations");

  cmd
    .command("info")
    .requiredOption("--path <abs>", "Absolute file path")
    .description("Show file metadata for a path within the active workspace")
    .action(async (opts: { path: string }) => {
      const flags = root.opts() as any;
      try {
        const abs = ensureAbsolutePath(String(opts.path));
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get(`/api/v1/files/info?path=${encodeURIComponent(abs)}`);
        const data = (res.data?.data ?? res.data) as {
          name: string;
          path: string;
          size: number;
          isDirectory: boolean;
          isBinary: boolean;
          mtimeMs: number;
          fileType: string | null;
        };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`Name: ${data.name}`);
        lines.push(`Path: ${data.path}`);
        lines.push(`Size: ${data.size} bytes`);
        lines.push(`Modified: ${new Date(data.mtimeMs).toISOString()}`);
        lines.push(`Directory: ${data.isDirectory}`);
        lines.push(`Binary: ${data.isBinary}`);
        lines.push(`Type: ${data.fileType ?? "unknown"}`);
        // eslint-disable-next-line no-console
        console.log(lines.join("\n"));
        process.exit(0);
      } catch (err: unknown) {
        const e = err as any;
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required")) {
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

  cmd
    .command("content")
    .requiredOption("--path <abs>", "Absolute file path")
    .option("--out <file>", "Write content to a local file (client-side)")
    .option("--overwrite", "Overwrite output file if it exists", false)
    .description("Read text content and token count for a file")
    .action(async (opts: { path: string; out?: string; overwrite?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const abs = ensureAbsolutePath(String(opts.path));
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get(`/api/v1/files/content?path=${encodeURIComponent(abs)}`);
        const data = (res.data?.data ?? res.data) as {
          content: string;
          tokenCount: number;
          fileType: string;
        };

        if (opts.out) {
          const { bytes } = await writeLocalFile(String(opts.out), data.content, Boolean(opts.overwrite));
          if (flags.json) {
            printJsonOrText({ outputPath: String(opts.out), bytes, tokenCount: data.tokenCount, fileType: data.fileType }, flags);
            process.exit(0);
          }
          // eslint-disable-next-line no-console
          console.log(`Wrote ${bytes} bytes to ${String(opts.out)} (tokens: ${data.tokenCount}, type: ${data.fileType})`);
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
        lines.push(`Tokens: ${data.tokenCount}`);
        lines.push(`Type: ${data.fileType}`);
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
        if (e instanceof Error && (e.message === "Absolute path required" || e.message === "Path is required")) {
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