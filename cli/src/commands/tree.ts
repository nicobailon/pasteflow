import { createClient, discover, handleAxiosError, printJsonOrText } from "../client";

const MODES = ["none", "selected", "selected-with-roots", "complete"] as const;

export function attachTreeCommand(root: any): void {
  root
    .command("tree")
    .description("Output the ASCII file tree for the active workspace selection and mode")
    .option("--list-modes", "List available file tree modes", false)
    .option("--mode <mode>", "Override file tree mode for this call")
    .action(async (opts: { listModes?: boolean; mode?: string }) => {
      const flags = root.opts() as any;

      // Handle --list-modes locally
      if (opts.listModes) {
        try {
          // Best-effort fetch of current mode from server
          const d = await discover(flags);
          const client = createClient(d, flags);
          const res = await client.get("/api/v1/tree");
          const data = (res.data?.data ?? res.data) as { mode: string };
          const current = String(data?.mode || "");

          if (flags.json) {
            printJsonOrText({ modes: MODES, currentMode: current || null }, flags);
          } else {
            for (const m of MODES) {
              if (current && m === current) console.log(`${m}  * - current`);
              else console.log(m);
            }
          }
          process.exit(0);
        } catch {
          // Fallback: no current mode available
          if (flags.json) {
            printJsonOrText({ modes: MODES, currentMode: null }, flags);
          } else {
            console.log(MODES.join("\n"));
          }
          process.exit(0);
        }
      }

      try {
        const d = await discover(flags);
        const client = createClient(d, flags);
        const q = new URLSearchParams();
        if (opts.mode) q.set("mode", String(opts.mode));
        const url = q.toString() ? `/api/v1/tree?${q.toString()}` : "/api/v1/tree";
        const res = await client.get(url);
        const data = (res.data?.data ?? res.data) as { mode: string; root: string; tree: string };

        if (flags.json) {
          printJsonOrText(data, flags);
          process.exit(0);
        }

        const lines: string[] = [];
        lines.push(`Root: ${data.root}`);
        lines.push(`Mode: ${data.mode}`);
        console.log(lines.join("\n"));
        console.log("");
        if (data.tree && data.tree.trim().length > 0) {
          console.log(data.tree);
        } else {
          console.log("(empty) — file tree mode is 'none' or no files selected.");
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
}
