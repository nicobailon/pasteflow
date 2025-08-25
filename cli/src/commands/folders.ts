import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";

export function attachFoldersCommand(root: any): void {
  const cmd = root.command("folders").description("Manage current folder/workspace binding");

  cmd
    .command("current")
    .description("Show the current workspace folder (if any)")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/folders/current");
        const data = (res.data?.data ?? res.data) as { folderPath: string } | null;

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        // eslint-disable-next-line no-console
        console.log(data?.folderPath ?? "null");
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

  cmd
    .command("open")
    .requiredOption("--folder <path>", "Folder path to open")
    .option("--name <name>", "Optional workspace name (auto-generated if omitted)")
    .description("Open a folder as a workspace (creates a workspace if needed and activates it)")
    .action(async (opts: { folder: string; name?: string }) => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.post("/api/v1/folders/open", {
          folderPath: String(opts.folder),
          name: opts.name ? String(opts.name) : undefined
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

        const lines: string[] = [];
        lines.push(`Workspace: ${data.name} (${data.id})`);
        lines.push(`Folder: ${data.folderPath}`);
        // eslint-disable-next-line no-console
        console.log(lines.join("\n"));
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