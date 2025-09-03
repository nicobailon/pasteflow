import { spawn } from "node:child_process";
import path from "node:path";

import { getAllowedWorkspacePaths } from "../workspace-context";

export async function runRipgrepJson({
  query,
  directory,
  maxResults = 3000,
}: {
  query: string;
  directory?: string;
  maxResults?: number;
}) {
  if (!query || typeof query !== "string") throw new Error("Invalid query");
  if (query.length > 256) throw new Error("Query too long");

  const roots = getAllowedWorkspacePaths();
  if (!roots || roots.length === 0) throw new Error("No active workspace");

  const chosenCwd = (() => {
    if (directory && typeof directory === "string") {
      const isAllowed = roots.some((root) => {
        try {
          const rel = path.relative(root, directory);
          return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
        } catch {
          return false;
        }
      });
      if (isAllowed) return directory;
    }
    return roots[0];
  })();

  const args = ["--json", "--line-number", "--color", "never", query, chosenCwd];

  const files: Record<
    string,
    { path: string; matches: Array<{ line: number; text: string; ranges: Array<{ start: number; end: number }> }> }
  > = {};
  let count = 0;

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (done) return;
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("ripgrep timeout"));
    }, 15_000);

    const handleClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };

    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e && e.code === "ENOENT") {
        reject(new Error("ripgrep not found (install 'rg')"));
      } else {
        reject(e);
      }
    });

    child.stdout.on("data", (buf: Buffer) => {
      const lines = buf.toString("utf8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "match") {
            const file = obj.data.path.text as string;
            const ln = obj.data.line_number as number;
            const text = obj.data.lines.text as string;
            const sub = (obj.data.submatches || []).map((m: any) => ({ start: m.start, end: m.end }));
            const bucket = files[file] || (files[file] = { path: file, matches: [] });
            bucket.matches.push({ line: ln, text, ranges: sub });
            if (++count >= maxResults) {
              try {
                child.kill("SIGKILL");
              } catch {}
            }
          }
        } catch {
          // ignore invalid lines
        }
      }
    });

    child.on("close", handleClose);
  });

  return { files: Object.values(files), totalMatches: count } as const;
}

