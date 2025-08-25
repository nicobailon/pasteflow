import { createClient, discover, formatAsTable, handleAxiosError, parseAtFile, parseJsonValue, printJsonOrText } from "../client";

// Use 'any' for Commander compatibility across differing type exports
export function attachWorkspacesCommand(root: any): void {
  const cmd = root.command("workspaces").description("Manage workspaces");

  // list
  cmd
    .command("list")
    .description("List all workspaces")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/workspaces");
        const rows = (res.data?.data ?? res.data) as {
          id: string;
          name: string;
          folderPath: string;
          updatedAt?: string;
          createdAt?: string;
          lastAccessed?: string;
        }[];

        if (flags.json) {
          printJsonOrText(rows, flags);
          process.exit(0);
        }

        if (rows.length === 0) {
           
          console.log("No workspaces found");
          process.exit(0);
        }

        const table = formatAsTable(rows, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "folderPath", header: "Folder" },
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

  // get
  cmd
    .command("get")
    .argument("<id>", "Workspace id")
    .description("Get a workspace by id")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get(`/api/v1/workspaces/${encodeURIComponent(id)}`);
        const data = (res.data?.data ?? res.data) as {
          id: string;
          name: string;
          folderPath: string;
          updatedAt?: string;
          createdAt?: string;
          lastAccessed?: string;
        } | null;

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        if (!data) {
           
          console.log("null");
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`ID: ${data.id}`, `Name: ${data.name}`, `Folder: ${data.folderPath}`);
        if (data.updatedAt) lines.push(`Updated: ${data.updatedAt}`);
        if (data.createdAt) lines.push(`Created: ${data.createdAt}`);
        if (data.lastAccessed) lines.push(`Last Accessed: ${data.lastAccessed}`);
         
        console.log(lines.join("\n"));
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

  // create
  cmd
    .command("create")
    .requiredOption("--name <name>", "Workspace name")
    .requiredOption("--folder <path>", "Workspace folder path")
    .option("--state <jsonOr@file>", "Initial state JSON or @file (optional)")
    .description("Create a new workspace")
    .action(async (opts: { name: string; folder: string; state?: string }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);

        const stateInput = parseAtFile(opts.state);
        const state = typeof stateInput === "string" ? (parseJsonValue(stateInput) ?? {}) : {};

        const res = await client.post("/api/v1/workspaces", {
          name: opts.name,
          folderPath: opts.folder,
          state
        });

        const data = (res.data?.data ?? res.data) as {
          id: string;
          name: string;
          folderPath: string;
        };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

         
        console.log(`Created workspace '${data.name}' (${data.id}) at ${data.folderPath}`);
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

  // update
  cmd
    .command("update")
    .argument("<id>", "Workspace id")
    .requiredOption("--state <jsonOr@file>", "New state JSON or @file")
    .description("Update workspace state by id")
    .action(async (id: string, opts: { state: string }) => {
      const flags = root.opts() as any;
      try {
        const stateInput = parseAtFile(opts.state);
        const state = typeof stateInput === "string" ? parseJsonValue(stateInput) : undefined;
        if (state === undefined) {
           
          console.error("VALIDATION_ERROR: --state must be valid JSON or @file");
          process.exit(2);
        }

        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.put(`/api/v1/workspaces/${encodeURIComponent(id)}`, { state });

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

  // delete
  cmd
    .command("delete")
    .argument("<id>", "Workspace id")
    .description("Delete a workspace by id")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.delete(`/api/v1/workspaces/${encodeURIComponent(id)}`);
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

  // rename
  cmd
    .command("rename")
    .argument("<id>", "Workspace id")
    .requiredOption("--to <newName>", "New workspace name")
    .description("Rename a workspace")
    .action(async (id: string, opts: { to: string }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post(`/api/v1/workspaces/${encodeURIComponent(id)}/rename`, { newName: String(opts.to) });
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

  // load
  cmd
    .command("load")
    .argument("<id>", "Workspace id")
    .description("Load a workspace as active")
    .action(async (id: string) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post(`/api/v1/workspaces/${encodeURIComponent(id)}/load`, {});
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