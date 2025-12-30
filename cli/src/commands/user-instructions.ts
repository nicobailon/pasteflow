import { createClient, discover, handleAxiosError, parseAtFile, printJsonOrText } from "../client";

export function attachUserInstructionsCommand(root: any): void {
  const cmd = root.command("user-instructions").description("Manage user instructions (get/set)");

  cmd
    .command("get")
    .description("Get current user instructions")
    .option("--raw", "Output raw content without formatting")
    .action(async (opts: { raw?: boolean }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/user-instructions");
        const data = (res.data?.data ?? res.data) as { content: string };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        if (opts.raw || flags.raw) {
          process.stdout.write(data.content ?? "");
        } else {
          console.log(data.content ?? "(empty)");
        }
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

  cmd
    .command("set")
    .requiredOption("--content <textOr@file>", "User instructions content (text or @file)")
    .description("Set user instructions")
    .action(async (opts: { content: string }) => {
      const flags = root.opts() as any;
      try {
        const content = parseAtFile(opts.content) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put("/api/v1/user-instructions", {
          content: String(content)
        });

        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        console.log(data ? "User instructions updated" : "false");
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

  cmd
    .command("clear")
    .description("Clear user instructions")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put("/api/v1/user-instructions", {
          content: ""
        });

        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        console.log(data ? "User instructions cleared" : "false");
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
