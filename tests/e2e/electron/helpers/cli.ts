import { spawn } from "node:child_process";
import path from "node:path";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  options?: {
    timeout?: number;
    cwd?: string;
  }
): Promise<CliResult> {
  const cliPath = path.resolve(__dirname, "../../../../cli/dist/index.mjs");
  const timeout = options?.timeout ?? 30_000;

  return new Promise((resolve, reject) => {
    const proc = spawn("node", [cliPath, ...args], {
      cwd: options?.cwd ?? process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`CLI timeout after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function runCliJson<T>(
  args: string[]
): Promise<{ exitCode: number; data: T | null; error?: string }> {
  const result = await runCli([...args, "--json"]);
  if (result.exitCode !== 0) {
    return {
      exitCode: result.exitCode,
      data: null,
      error: result.stderr || result.stdout,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const data =
      parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed.data as T)
        : (parsed as T);
    return { exitCode: 0, data };
  } catch {
    return {
      exitCode: result.exitCode,
      data: null,
      error: "Failed to parse JSON output",
    };
  }
}
