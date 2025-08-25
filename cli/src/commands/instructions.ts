import { createClient, discover, formatAsTable, handleAxiosError, parseAtFile, printJsonOrText } from "../client";

export function attachInstructionsCommand(root: any): void {
  const cmd = root.command("instructions").description("Manage instructions (list/create/update/delete)");

  // list
  cmd
    .command("list")
    .description("List all instructions")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/instructions");
        const rows = (res.data?.data ?? res.data) as Array<{
          id: string;
          name: string;
          content: string;
          updatedAt?: string;
          createdAt?: string;
        }>;

        if (flags.json) {
          printJsonOrText(rows, flags);
          process.exit(0);
        }

        if (!rows.length) {
          // eslint-disable-next-line no-console
          console.log("No instructions found");
          process.exit(0);
        }

        const table = formatAsTable(rows, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "updatedAt", header: "Updated" }
        ]);
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

  // create
  cmd
    .command("create")
    .requiredOption("--name <name>", "Instruction name")
    .requiredOption("--content <textOr@file>", "Instruction content (text or @file)")
    .option("--id <id>", "Optional instruction id (uuid)")
    .description("Create a new instruction")
    .action(async (opts: { name: string; content: string; id?: string }) => {
      const flags = root.opts() as any;
      try {
        const content = parseAtFile(opts.content) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/instructions", {
          id: opts.id,
          name: String(opts.name),
          content: String(content)
        });

        const data = (res.data?.data ?? res.data) as { id: string; name: string; content: string };
        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.log(`Created instruction '${data.name}' (${data.id})`);
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

  // update
  cmd
    .command("update")
    .argument("<id>", "Instruction id")
    .requiredOption("--name <name>", "New name")
    .requiredOption("--content <textOr@file>", "New content (text or @file)")
    .description("Update an instruction")
    .action(async (id: string, opts: { name: string; content: string }) => {
      const flags = root.opts() as any;
      try {
        const content = parseAtFile(opts.content) ?? "";
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put(`/api/v1/instructions/${encodeURIComponent(id)}`, {
          name: String(opts.name),
          content: String(content)
        });

        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.log(data ? "true" : "false");
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

  // delete
  cmd
    .command("delete")
    .argument("<id>", "Instruction id")
    .description("Delete an instruction")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.delete(`/api/v1/instructions/${encodeURIComponent(id)}`);
        const data = (res.data?.data ?? res.data) as boolean;
        if (flags.json) {
          printJsonOrText({ ok: data }, flags);
          process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.log(data ? "true" : "false");
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