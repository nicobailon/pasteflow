import { createClient, discover, formatAsTable, handleAxiosError, parseAtFile, printJsonOrText } from "../client";

export function attachSystemPromptsCommand(root: any): void {
  const cmd = root.command("system-prompts").description("Manage system prompts (list/create/update/delete)");

  cmd
    .command("list")
    .description("List all system prompts")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/prompts/system");
        const rows = (res.data?.data ?? res.data) as {
          id: string;
          name: string;
          content: string;
          updatedAt?: string;
          createdAt?: string;
        }[];

        if (flags.json) {
          printJsonOrText(rows, flags);
          process.exit(0);
        }

        if (rows.length === 0) {
          console.log("No system prompts found");
          process.exit(0);
        }

        const table = formatAsTable(rows, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "updatedAt", header: "Updated" }
        ]);
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

  cmd
    .command("create")
    .requiredOption("--name <name>", "Prompt name")
    .requiredOption("--content <textOr@file>", "Prompt content (text or @file)")
    .option("--id <id>", "Optional prompt id (uuid)")
    .description("Create a new system prompt")
    .action(async (opts: { name: string; content: string; id?: string }) => {
      const flags = root.opts() as any;
      try {
        const content = parseAtFile(opts.content) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/prompts/system", {
          id: opts.id,
          name: String(opts.name),
          content: String(content)
        });

        const data = (res.data?.data ?? res.data) as { id: string; name: string; content: string };
        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }
        console.log(`Created system prompt '${data.name}' (${data.id})`);
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
    .command("update")
    .argument("<id>", "Prompt id")
    .requiredOption("--name <name>", "New name")
    .requiredOption("--content <textOr@file>", "New content (text or @file)")
    .description("Update a system prompt")
    .action(async (id: string, opts: { name: string; content: string }) => {
      const flags = root.opts() as any;
      try {
        const content = parseAtFile(opts.content) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put(`/api/v1/prompts/system/${encodeURIComponent(id)}`, {
          name: String(opts.name),
          content: String(content)
        });

        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        console.log(data ? "true" : "false");
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
    .command("delete")
    .argument("<id>", "Prompt id")
    .description("Delete a system prompt")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.delete(`/api/v1/prompts/system/${encodeURIComponent(id)}`);
        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        console.log(data ? "true" : "false");
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
