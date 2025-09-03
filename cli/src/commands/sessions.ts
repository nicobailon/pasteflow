import { Command } from "commander";
import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";

export function attachSessionsCommand(root: Command): void {
  root
    .command("export-session")
    .description("Export an agent chat session to JSON or file")
    .requiredOption("--id <SESSION_ID>", "Session id to export")
    .option("--out <FILE>", "Write export to file path")
    .option("--stdout", "Print JSON payload to stdout", false)
    .action(async (opts: { id: string; out?: string; stdout?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/agent/export-session", { id: opts.id, outPath: opts.out, download: opts.stdout === true });
        const data = (res.data?.data ?? res.data) as any;
        if (opts.out) {
          if (flags.json) {
            printJsonOrText({ file: data.file }, flags);
          } else {
            console.log(`Exported session to: ${data.file}`);
          }
          process.exit(0);
        }
        // stdout/json path
        if (flags.json || opts.stdout) {
          printJsonOrText(data, { ...flags, json: true } as any);
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
        process.exit(0);
      } catch (error) {
        const mapped = handleAxiosError(error, flags);
        if (flags.json && mapped.json) printJsonOrText(mapped.json, flags);
        else if (mapped.message) console.error(mapped.message);
        process.exit(mapped.exitCode);
      }
    });
}

