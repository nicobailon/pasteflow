import { createClient, discover, handleAxiosError, parseAtFile, printJsonOrText } from "../client";

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

        // eslint-disable-next-line no-console
        console.log(`Tokens: ${data.count}${data.backend ? ` (backend: ${data.backend})` : ""}`);
        process.exit(0);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        // Map local @file read errors to VALIDATION_ERROR (exit code 2)
        if (e && (e.code === "ENOENT" || e.code === "EISDIR" || e.code === "EACCES")) {
          if (flags.json) {
            printJsonOrText({ error: { code: "VALIDATION_ERROR", message: e.message } }, flags);
          } else {
            // eslint-disable-next-line no-console
            console.error(`VALIDATION_ERROR: ${e.message}`);
          }
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

        // eslint-disable-next-line no-console
        console.log(data.backend);
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