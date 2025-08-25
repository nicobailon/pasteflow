import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";

export function attachStatusCommand(root: any): void {
  root
    .command("status")
    .description("Show server status, active workspace, and allowed paths")
    .action(async () => {
      const flags = root.opts() as any;
      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const res = await client.get("/api/v1/status");
        const data = (res.data?.data ?? res.data) as {
          status: string;
          activeWorkspace: { id: string; name: string; folderPath: string } | null;
          securityContext: { allowedPaths: string[] };
        };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`Server: ${data.status} (${d.baseURL})`);
        if (data.activeWorkspace) {
          lines.push(
            `Active Workspace: ${data.activeWorkspace.name} [${data.activeWorkspace.id}]`, `Folder: ${data.activeWorkspace.folderPath}`
          );
        } else {
          lines.push("Active Workspace: none");
        }
        const allowed = data.securityContext?.allowedPaths ?? [];
        if (allowed.length > 0) {
          lines.push("Allowed Paths:");
          for (const p of allowed) lines.push(`  - ${p}`);
        } else {
          lines.push("Allowed Paths: (none)", 
            "Hint: run 'pasteflow folders open --folder /abs/path' or 'pasteflow workspaces load <id>'",
          );
        }

         
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
}