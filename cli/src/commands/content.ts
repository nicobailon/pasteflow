import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";
import {
  ContentData,
  CommandFlags,
  handleOutputFile,
  handleContentDisplay,
  handleFileSystemError,
  buildContentQueryString,
  writeLocalFile
} from "./content-helpers";

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
      const flags = root.opts() as CommandFlags;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);

        const url = buildContentQueryString(opts);
        const res = await client.get(url);
        const data = (res.data?.data ?? res.data) as ContentData;

        if (opts.out) {
          await handleOutputFile(
            String(opts.out),
            data.content,
            Boolean(opts.overwrite),
            data,
            flags
          );
          process.exit(0);
        }

        handleContentDisplay(data, flags);
        process.exit(0);
      } catch (error: unknown) {
        handleFileSystemError(error, flags);
        
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) {
          printJsonOrText(mapped.json, flags);
        } else if (mapped.message) {
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
      const flags = root.opts() as CommandFlags;
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

         
        console.log(`Exported ${data.bytes} bytes to ${data.outputPath}`);
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