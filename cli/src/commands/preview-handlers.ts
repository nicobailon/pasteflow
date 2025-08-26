import fs from "node:fs";
import path from "node:path";

import { AxiosInstance } from "axios";

import { parseAtFileAsync, printJsonOrText, handleAxiosError, GlobalFlags } from "../client";

export type PreviewState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface PreviewOptions {
  includeTrees?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  prompt?: string;
  follow?: boolean;
  waitMs?: number;
  out?: string;
  overwrite?: boolean;
}

export interface PreviewResult {
  state: PreviewState;
  error?: { code: string; message: string };
}

export interface PreviewContent {
  id: string;
  content: string;
  tokenCount: number;
  fileCount: number;
}

export interface PreviewStartResponse {
  data?: {
    data?: { id: string };
  } | { id: string };
}

export async function preparePreviewRequest(opts: PreviewOptions) {
  const prompt = await parseAtFileAsync(opts.prompt);
  
  return {
    includeTrees: Boolean(opts.includeTrees) || undefined,
    maxFiles: Number.isFinite(opts.maxFiles) && (opts.maxFiles as number) > 0 ? Number(opts.maxFiles) : undefined,
    maxBytes: Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0 ? Number(opts.maxBytes) : undefined,
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}

export function setupAbortController(): { ac: AbortController; cleanup: () => void } {
  const ac = new AbortController();
  const onSigint = () => ac.abort();
  
  try {
    process.once("SIGINT", onSigint);
  } catch {
    // Intentionally empty - non-critical operation
  }
  
  const cleanup = () => {
    try {
      process.off("SIGINT", onSigint);
    } catch {
      // Intentionally empty - non-critical operation
    }
  };
  
  return { ac, cleanup };
}

export async function handlePreviewSuccess(
  client: AxiosInstance,
  id: string,
  opts: PreviewOptions,
  flags: GlobalFlags
) {
  const contentRes = await client.get<{ data?: PreviewContent } | PreviewContent>(
    `/api/v1/preview/content/${encodeURIComponent(id)}`
  );
  const contentData = ('data' in contentRes.data && contentRes.data.data) 
    ? contentRes.data.data 
    : contentRes.data as PreviewContent;
  
  if (opts.out) {
    const { bytes } = await writeLocalFile(String(opts.out), contentData.content, Boolean(opts.overwrite));
    
    if (flags.json) {
      printJsonOrText({
        id,
        outputPath: String(opts.out),
        bytes,
        tokenCount: contentData.tokenCount,
        fileCount: contentData.fileCount
      }, flags);
    } else {
      console.log(`Wrote ${bytes} bytes to ${String(opts.out)} (files: ${contentData.fileCount}, tokens: ${contentData.tokenCount})`);
    }
    return;
  }
  
  if (flags.json) {
    printJsonOrText({ id, ...contentData }, flags);
    return;
  }
  
  if (flags.raw) {
    console.log(contentData.content);
    return;
  }
  
  const lines = [`Files: ${contentData.fileCount}`, `Tokens: ${contentData.tokenCount}`, ""];
  console.log(lines.join("\n") + contentData.content);
}

export function handlePreviewFailure(
  id: string,
  result: PreviewResult,
  flags: GlobalFlags
): number {
  if (result.state === "CANCELLED") {
    if (flags.json) {
      printJsonOrText({ id, state: "CANCELLED" }, flags);
    } else {
      console.error("CANCELLED");
    }
    return 1;
  }
  
  // FAILED
  if (flags.json) {
    printJsonOrText({
      id,
      state: "FAILED",
      error: result.error || { code: "INTERNAL_ERROR", message: "Preview failed" }
    }, flags);
  } else {
    console.error(`FAILED: ${result.error?.message || "Preview failed"}`);
  }
  return 1;
}

type FileSystemError = Error & { code?: string };

export function handlePreviewError(error: unknown, flags: GlobalFlags): number {
  const e = error as FileSystemError;
  
  // Handle user cancellation via AbortController
  if (e?.code === "ERR_CANCELED") {
    if (flags.json) {
      printJsonOrText({ error: { code: "CANCELLED", message: "Operation cancelled by user (SIGINT)" } }, flags);
    } else {
      console.error("CANCELLED");
    }
    return 1;
  }
  
  // Map local @file read errors
  if (e && typeof e === "object" && "code" in e && typeof e.code === "string") {
    const code = e.code;
    
    if (code === "ENOENT" || code === "EISDIR" || code === "EACCES") {
      if (flags.json) {
        printJsonOrText({ error: { code: "VALIDATION_ERROR", message: e.message } }, flags);
      } else {
        console.error(`VALIDATION_ERROR: ${e.message}`);
      }
      return 2;
    }
    
    if (code === "EEXIST") {
      if (flags.json) {
        printJsonOrText({ error: { code: "CONFLICT", message: "File exists; use --overwrite" } }, flags);
      } else {
        console.error("CONFLICT: File exists; use --overwrite");
      }
      return 5;
    }
    
    if (code === "EACCES" || code === "EISDIR" || code === "ENOTDIR" || code === "EPERM" || code === "EBUSY") {
      if (flags.json) {
        printJsonOrText({ error: { code: "FILE_SYSTEM_ERROR", message: e.message } }, flags);
      } else {
        console.error(`FILE_SYSTEM_ERROR: ${e.message}`);
      }
      return 1;
    }
  }
  
  const mapped = handleAxiosError(error, flags);
  if (flags.json && mapped.json) {
    printJsonOrText(mapped.json, flags);
  } else if (mapped.message) {
    console.error(mapped.message);
  }
  return mapped.exitCode;
}

export async function writeLocalFile(
  outputPath: string,
  content: string,
  overwrite: boolean
): Promise<{ bytes: number }> {
  const absPath = path.resolve(outputPath);
  
  if (!overwrite && fs.existsSync(absPath)) {
    const err = new Error("File exists; use --overwrite") as FileSystemError;
    err.code = "EEXIST";
    throw err;
  }
  
  await fs.promises.writeFile(absPath, content, "utf8");
  const st = await fs.promises.stat(absPath);
  
  return { bytes: st.size };
}

interface StatusResponse {
  data?: {
    data?: PreviewResult & { state: PreviewState };
  } | (PreviewResult & { state: PreviewState });
}

export async function followUntilTerminal(
  client: AxiosInstance,
  id: string,
  waitMs: number,
  flags: GlobalFlags,
  signal?: AbortSignal
): Promise<PreviewResult> {
  const start = Date.now();
  let delay = 250;
  const maxDelay = 3000;
  let iterations = 0;
  const maxIterations = 10_000;
  
  while (!signal?.aborted) {
    try {
      const res = await client.get<StatusResponse['data']>(
        `/api/v1/preview/status/${encodeURIComponent(id)}`,
        { signal }
      );
      
      const data = (res.data && 'data' in res.data && res.data.data) 
        ? res.data.data 
        : res.data as (PreviewResult & { state: PreviewState });
      
      if (flags.debug) {
        console.error(`[debug] preview status: ${data.state} (attempt ${iterations + 1})`);
      }
      
      if (data.state === "SUCCEEDED" || data.state === "FAILED" || data.state === "CANCELLED") {
        return data;
      }
      
      await sleep(delay);
      delay = Math.min(Math.floor(delay * 1.5), maxDelay);
      iterations += 1;
      
      if (iterations > maxIterations || Date.now() - start > waitMs) {
        return { state: "FAILED", error: { code: "PREVIEW_TIMEOUT", message: "Preview job timed out" } };
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // Retry on transient errors
      await sleep(delay);
      iterations += 1;
    }
  }
  
  const cancelError = new Error("Aborted") as FileSystemError;
  cancelError.code = "ERR_CANCELED";
  throw cancelError;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
