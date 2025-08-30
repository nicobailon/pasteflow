import { AxiosInstance } from "axios";

import { createClient, discover, GlobalFlags } from "../client";

import {
  PreviewOptions,
  PreviewState,
  preparePreviewRequest,
  setupAbortController,
  handlePreviewSuccess,
  handlePreviewFailure,
  handlePreviewError,
  followUntilTerminal,
  writeLocalFile,
  sleep
} from "./preview-handlers";

interface CommanderCommand {
  command(name: string): CommanderCommand;
  description(desc: string): CommanderCommand;
  option(flags: string, description: string, defaultValue?: unknown): CommanderCommand;
  option(flags: string, description: string, fn?: (value: string) => unknown, defaultValue?: unknown): CommanderCommand;
  argument(syntax: string, description: string): CommanderCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CommanderCommand;
  opts(): GlobalFlags;
}

export function attachPreviewCommand(root: CommanderCommand): void {
  const cmd = root.command("preview").description("Preview generation (async)");

  // preview start
  attachStartCommand(cmd, root);
  
  // preview status
  attachStatusCommand(cmd, root);
  
  // preview content
  attachContentCommand(cmd, root);
  
  // preview cancel
  attachCancelCommand(cmd, root);
}

function attachStartCommand(cmd: CommanderCommand, root: CommanderCommand): void {
  cmd
    .command("start")
    .option("--include-trees", "Include file trees in preview", false)
    .option("--max-files <n>", "Max number of files to include", (v) => Number.parseInt(v, 10))
    .option("--max-bytes <n>", "Max total bytes to include", (v) => Number.parseInt(v, 10))
    .option("--prompt <textOr@file>", "Prompt text or @file with prompt content")
    .option("--follow", "Poll status until terminal; fetch content on success", false)
    .option("--wait-ms <ms>", "Max total time to wait when --follow is set (default 180000)", (v) => Number.parseInt(v, 10))
    .option("--out <file>", "Write preview content to a local file (when --follow)")
    .option("--overwrite", "Overwrite output file if it exists", false)
    .description("Start a preview job")
    .action(async (opts: PreviewOptions) => {
      const flags = root.opts();
      await executeStartCommand(opts, flags);
    });
}

async function executeStartCommand(opts: PreviewOptions, flags: GlobalFlags): Promise<void> {
  try {
    const d = await discover(flags);
    const client = createClient(d, flags);
    
    // Start preview job
    const request = await preparePreviewRequest(opts);
    const res = await client.post("/api/v1/preview/start", request);
    const data = (res.data?.data ?? res.data) as { id: string };
    
    if (!opts.follow) {
      handleImmediateReturn(data.id, flags);
      return;
    }
    
    // Follow mode
    await handleFollowMode(client, data.id, opts, flags);
  } catch (error: unknown) {
    const exitCode = handlePreviewError(error, flags);
    process.exit(exitCode);
  }
}

function handleImmediateReturn(id: string, flags: GlobalFlags): void {
  if (flags.json) {
    console.log(JSON.stringify({ id }));
  } else {
    console.log(id);
  }
  process.exit(0);
}

async function handleFollowMode(
  client: AxiosInstance,
  id: string,
  opts: PreviewOptions,
  flags: GlobalFlags
): Promise<void> {
  const waitMs = Number.isFinite(opts.waitMs) && (opts.waitMs as number) > 0 
    ? Number(opts.waitMs) 
    : 180_000;
  
  const { ac, cleanup } = setupAbortController();
  
  try {
    const result = await followUntilTerminal(client, id, waitMs, flags, ac.signal);
    
    if (result.state === "SUCCEEDED") {
      await handlePreviewSuccess(client, id, opts, flags);
      process.exit(0);
    } else {
      const exitCode = handlePreviewFailure(id, result, flags);
      process.exit(exitCode);
    }
  } finally {
    cleanup();
  }
}

function attachStatusCommand(cmd: CommanderCommand, root: CommanderCommand): void {
  cmd
    .command("status")
    .argument("<id>", "Preview job id")
    .option("--watch", "Poll status until terminal state", false)
    .option("--interval-ms <n>", "Polling interval (initial) in ms", (v) => Number.parseInt(v, 10))
    .description("Get preview job status")
    .action(async (id: string, opts: { watch?: boolean; intervalMs?: number }) => {
      const flags = root.opts();
      await executeStatusCommand(id, opts, flags);
    });
}

async function executeStatusCommand(
  id: string,
  opts: { watch?: boolean; intervalMs?: number },
  flags: GlobalFlags
): Promise<void> {
  try {
    const d = await discover(flags);
    const client = createClient(d, flags);
    
    if (!opts.watch) {
      await fetchSingleStatus(client, id, flags);
      return;
    }
    
    await watchStatus(client, id, opts.intervalMs, flags);
  } catch (error) {
    const exitCode = handlePreviewError(error, flags);
    process.exit(exitCode);
  }
}

async function fetchSingleStatus(client: AxiosInstance, id: string, flags: GlobalFlags): Promise<void> {
  const res = await client.get(`/api/v1/preview/status/${encodeURIComponent(id)}`);
  const data = res.data?.data ?? res.data;
  
  if (flags.json) {
    console.log(JSON.stringify(data));
  } else {
    const statusDetails = data.error ? ` — ${data.error.code}: ${data.error.message}` : "";
    console.log(`${data.state}${statusDetails}`);
  }
  process.exit(0);
}

async function watchStatus(
  client: AxiosInstance,
  id: string,
  intervalMs: number | undefined,
  flags: GlobalFlags
): Promise<void> {
  const start = Date.now();
  let delay = Number.isFinite(intervalMs) && (intervalMs as number) > 0 ? Number(intervalMs) : 250;
  const maxDelay = 3000;
  let iterations = 0;
  const maxIterations = 10_000;
  
  const ac = new AbortController();
  try {
    process.once("SIGINT", () => ac.abort());
  } catch {
    // Intentionally empty - non-critical operation
  }
  
  while (!ac.signal.aborted) {
    const res = await client.get(`/api/v1/preview/status/${encodeURIComponent(id)}`, { signal: ac.signal });
    const data = res.data?.data ?? res.data;
    
    if (isTerminalState(data.state)) {
      outputStatusResult(data, flags);
      process.exit(data.state === "SUCCEEDED" ? 0 : 1);
    }
    
    await sleep(delay);
    delay = Math.min(Math.floor(delay * 1.5), maxDelay);
    iterations += 1;
    
    if (iterations > maxIterations || Date.now() - start > 180_000) {
      console.error("Watch timeout exceeded (safety guard)");
      process.exit(1);
    }
  }
  
  // Aborted by user
  if (flags.json) {
    console.log(JSON.stringify({ error: { code: "CANCELLED", message: "Operation cancelled by user (SIGINT)" } }));
  } else {
    console.error("CANCELLED");
  }
  process.exit(1);
}

function isTerminalState(state: PreviewState): boolean {
  return state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED";
}

function outputStatusResult(data: { state: PreviewState; error?: { code: string; message: string } }, flags: GlobalFlags): void {
  if (flags.json) {
    console.log(JSON.stringify(data));
  } else {
    const statusDetails = data.error ? ` — ${data.error.code}: ${data.error.message}` : "";
    console.log(`${data.state}${statusDetails}`);
  }
}

function attachContentCommand(cmd: CommanderCommand, root: CommanderCommand): void {
  cmd
    .command("content")
    .argument("<id>", "Preview job id")
    .option("--out <file>", "Write preview content to a local file")
    .option("--overwrite", "Overwrite output file if it exists", false)
    .description("Fetch preview content for a completed job")
    .action(async (id: string, opts: { out?: string; overwrite?: boolean }) => {
      const flags = root.opts();
      await executeContentCommand(id, opts, flags);
    });
}

async function executeContentCommand(
  id: string,
  opts: { out?: string; overwrite?: boolean },
  flags: GlobalFlags
): Promise<void> {
  try {
    const d = await discover(flags);
    const client = createClient(d, flags);
    
    const res = await client.get(`/api/v1/preview/content/${encodeURIComponent(id)}`);
    const data = (res.data?.data ?? res.data) as { id: string; content: string; tokenCount: number; fileCount: number };
    
    if (opts.out) {
      await handleFileOutput(id, data, opts, flags);
    } else {
      outputContent(data, flags);
    }
    
    process.exit(0);
  } catch (error: unknown) {
    const exitCode = handlePreviewError(error, flags);
    process.exit(exitCode);
  }
}

async function handleFileOutput(
  id: string,
  data: { content: string; tokenCount: number; fileCount: number },
  opts: { out?: string; overwrite?: boolean },
  flags: GlobalFlags
): Promise<void> {
  const { bytes } = await writeLocalFile(String(opts.out), data.content, Boolean(opts.overwrite));
  
  if (flags.json) {
    console.log(JSON.stringify({
      id,
      outputPath: String(opts.out),
      bytes,
      tokenCount: data.tokenCount,
      fileCount: data.fileCount
    }));
  } else {
    console.log(`Wrote ${bytes} bytes to ${String(opts.out)} (files: ${data.fileCount}, tokens: ${data.tokenCount})`);
  }
}

function outputContent(
  data: { id?: string; content: string; tokenCount: number; fileCount: number },
  flags: GlobalFlags
): void {
  if (flags.json) {
    console.log(JSON.stringify(data));
  } else if (flags.raw) {
    console.log(data.content);
  } else {
    const lines = [`Files: ${data.fileCount}`, `Tokens: ${data.tokenCount}`, ""];
    console.log(lines.join("\n") + data.content);
  }
}

function attachCancelCommand(cmd: CommanderCommand, root: CommanderCommand): void {
  cmd
    .command("cancel")
    .argument("<id>", "Preview job id")
    .description("Cancel a running preview job")
    .action(async (id: string) => {
      const flags = root.opts();
      await executeCancelCommand(id, flags);
    });
}

async function executeCancelCommand(id: string, flags: GlobalFlags): Promise<void> {
  try {
    const d = await discover(flags);
    const client = createClient(d, flags);
    
    const res = await client.post(`/api/v1/preview/cancel/${encodeURIComponent(id)}`, {});
    const ok = (res.data?.data ?? res.data) as boolean;
    
    if (flags.json) {
      console.log(JSON.stringify({ ok }));
    } else {
      console.log(ok ? "true" : "false");
    }
    
    process.exit(0);
  } catch (error) {
    const exitCode = handlePreviewError(error, flags);
    process.exit(exitCode);
  }
}