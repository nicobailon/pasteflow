import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import type { SystemExecutionContext } from "../../shared-types/system-execution-context";

export async function collectSystemExecutionContext(): Promise<SystemExecutionContext> {
  const cwd = safeString(process.cwd());
  const home = safeString(os.homedir());

  const platform = {
    os: `${safeString(os.platform())} ${safeString(os.release())}`.trim(),
    arch: safeString(os.arch()),
    version: typeof (os as any).version === "function" ? safeString((os as any).version()) : safeString(os.release()),
  };

  const shell = await detectShell();

  const timestamp = new Date().toISOString();

  return {
    directory: { cwd, home },
    platform,
    timestamp,
    shell,
  };
}

function safeString(v: unknown): string {
  try { return String(v ?? ""); } catch { return ""; }
}

async function detectShell(): Promise<SystemExecutionContext["shell"]> {
  try {
    if (process.platform === "win32") {
      const comp = process.env.COMSPEC || "";
      const name = path.basename(comp || "powershell.exe");
      let version: string | undefined;
      try {
        if (/powershell/i.test(name) || /pwsh/i.test(name)) {
          // Prefer modern PowerShell if available
          const cmd = (name.toLowerCase().includes("pwsh") ? "pwsh" : "powershell");
          const out = execSync(`${cmd} -NoLogo -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"`, { stdio: ["ignore", "pipe", "ignore"] });
          version = String(out?.toString?.("utf8") || "").trim() || undefined;
        }
      } catch { /* noop */ }
      return { name, version, path: comp || undefined };
    }

    // POSIX-ish
    const shPath = process.env.SHELL || "/bin/bash";
    const name = path.basename(shPath || "sh");
    let version: string | undefined;
    try {
      const tryCmds = [
        `${JSON.stringify(shPath)} --version`,
        `${JSON.stringify(name)} --version`,
        `${JSON.stringify(shPath)} -version`,
        `${JSON.stringify(name)} -version`,
      ];
      for (const cmd of tryCmds) {
        try {
          const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] });
          const firstLine = String(out?.toString?.("utf8") || "").split(/\r?\n/, 1)[0];
          const v = extractVersion(firstLine) || firstLine.trim();
          if (v) { version = v; break; }
        } catch { /* try next */ }
      }
    } catch { /* noop */ }
    return { name, version, path: shPath || undefined };
  } catch {
    return { name: "shell" };
  }
}

function extractVersion(line: string): string | undefined {
  try {
    const m = line.match(/\b(\d+\.\d+(?:\.\d+)?(?:[\w.-]+)?)/);
    return m?.[1];
  } catch { return undefined; }
}

