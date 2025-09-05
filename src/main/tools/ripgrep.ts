import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getAllowedWorkspacePaths } from "../workspace-context";

export async function runRipgrepJson({
  query,
  directory,
  maxResults = 3000,
  maxFiles = 200,
  maxBytes = 1_000_000,
  signal,
}: {
  query: string;
  directory?: string;
  maxResults?: number;
  maxFiles?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}) {
  if (!query || typeof query !== "string") throw new Error("Invalid query");
  if (query.length > 256) throw new Error("Query too long");

  const rootsRaw = getAllowedWorkspacePaths();
  const roots = (!rootsRaw || rootsRaw.length === 0) ? [process.cwd()] : [...rootsRaw];

  const chosenCwd = (() => {
    if (directory && typeof directory === "string") {
      const isAllowed = roots.some((root) => {
        try {
          const rel = path.relative(root, directory);
          return !rel.startsWith("..") && !path.isAbsolute(rel);
        } catch {
          return false;
        }
      });
      if (isAllowed) return directory;
    }
    return roots[0];
  })();

  const args = ["--json", "--line-number", "--color", "never"] as string[];
  const gi = findNearestGitignore(chosenCwd, roots);
  if (gi) {
    args.push("--ignore-file", gi);
  }
  args.push(query, chosenCwd);

  const files: Record<
    string,
    { path: string; matches: Array<{ line: number; text: string; ranges: Array<{ start: number; end: number }> }> }
  > = {};
  let count = 0;
  let uniqueFiles = 0;
  let totalBytes = 0;
  let truncated = false;

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

    const abortHandler = () => {
      try { child.kill("SIGKILL"); } catch {}
      clearTimeout(timer);
      reject(new Error("ripgrep canceled"));
    };
    if (signal) {
      if (signal.aborted) return abortHandler();
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    const handleClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      resolve();
    };

    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      if (e && e.code === "ENOENT") {
        reject(new Error("ripgrep not found (install 'rg')"));
      } else {
        reject(e);
      }
    });

    let stdoutBuf = "";
    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "match") {
          const file = obj.data.path.text as string;
          const ln = obj.data.line_number as number;
          const text = obj.data.lines.text as string;
          const sub = (obj.data.submatches || []).map((m: any) => ({ start: m.start, end: m.end }));
          let bucket = files[file];
          if (!bucket) {
            if (uniqueFiles >= maxFiles) { truncated = true; try { child.kill("SIGKILL"); } catch {} return; }
            bucket = files[file] = { path: file, matches: [] };
            uniqueFiles++;
          }
          bucket.matches.push({ line: ln, text, ranges: sub });
          totalBytes += Buffer.byteLength(text, "utf8");
          if (++count >= maxResults || totalBytes >= maxBytes) {
            try { child.kill("SIGKILL"); } catch {}
            truncated = true;
          }
        }
      } catch {
        // ignore invalid lines (will be completed by next chunk if partial)
      }
    };

    child.stdout.on("data", (buf: Buffer) => {
      stdoutBuf += buf.toString("utf8");
      const lastNL = stdoutBuf.lastIndexOf("\n");
      if (lastNL === -1) return; // no full line yet
      const complete = stdoutBuf.slice(0, lastNL);
      stdoutBuf = stdoutBuf.slice(lastNL + 1);
      const lines = complete.split("\n");
      for (const line of lines) processLine(line);
    });

    child.on("close", () => {
      // attempt to parse any trailing data without newline
      if (stdoutBuf && stdoutBuf.trim()) processLine(stdoutBuf);
      handleClose();
    });
  });

  return { files: Object.values(files), totalMatches: count, truncated } as const;
}

function findNearestGitignore(startDir: string, allowedRoots: readonly string[]): string | null {
  try {
    let dir = startDir;
    const rootSet = new Set(allowedRoots);
    for (let i = 0; i < 50; i++) {
      const p = path.join(dir, ".gitignore");
      if (fs.existsSync(p)) return p;
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      const withinAllowed = [...rootSet].some((r) => {
        try {
          const rel = path.relative(r, parent);
          return !rel.startsWith("..") && !path.isAbsolute(rel);
        } catch { return false; }
      });
      if (!withinAllowed) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}
