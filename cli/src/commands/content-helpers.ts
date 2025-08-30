// Helper functions extracted from content.ts to reduce complexity

import fs from "node:fs";
import path from "node:path";

import { printJsonOrText } from "../client";

export interface ContentData {
  content: string;
  fileCount: number;
  tokenCount: number;
}

export interface CommandFlags {
  json?: boolean;
  raw?: boolean;
  debug?: boolean;
  host?: string;
  port?: number;
  token?: string;
  timeout?: number;
}

interface FileSystemError extends Error {
  code?: string;
}

const FILE_SYSTEM_ERROR_CODES = ["EACCES", "EISDIR", "ENOTDIR", "EPERM", "EBUSY"] as const;
type FileSystemErrorCode = typeof FILE_SYSTEM_ERROR_CODES[number];

function isFileSystemError(error: unknown): error is FileSystemError {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as FileSystemError).code === "string"
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isFileSystemError(error) && error.code === code;
}

export async function handleOutputFile(
  outputPath: string,
  content: string,
  overwrite: boolean,
  data: ContentData,
  flags: CommandFlags
): Promise<void> {
  const { bytes } = await writeLocalFile(outputPath, content, overwrite);
  
  if (flags.json) {
    printJsonOrText({
      outputPath,
      bytes,
      fileCount: data.fileCount,
      tokenCount: data.tokenCount
    }, flags);
  } else {
    console.log(`Wrote ${bytes} bytes to ${outputPath} (files: ${data.fileCount}, tokens: ${data.tokenCount})`);
  }
}

export function handleContentDisplay(
  data: ContentData,
  flags: CommandFlags
): void {
  if (flags.json) {
    printJsonOrText(data, flags);
    return;
  }

  if (flags.raw) {
    console.log(data.content);
    return;
  }

  const lines: string[] = [
    `Files: ${data.fileCount}`,
    `Tokens: ${data.tokenCount}`,
    ""
  ];
  console.log(lines.join("\n") + data.content);
}

export function handleFileSystemError(error: unknown, flags: CommandFlags): void {
  if (hasErrorCode(error, "EEXIST")) {
    if (flags.json) {
      printJsonOrText({
        error: { code: "CONFLICT", message: "File exists; use --overwrite" }
      }, flags);
    } else {
      console.error("CONFLICT: File exists; use --overwrite");
    }
    process.exit(5);
  }

  // Map local filesystem write errors to FILE_SYSTEM_ERROR
  if (isFileSystemError(error) && error.code) {
    const isKnownFsError = FILE_SYSTEM_ERROR_CODES.includes(error.code as FileSystemErrorCode);
    
    if (isKnownFsError) {
      if (flags.json) {
        printJsonOrText({
          error: { code: "FILE_SYSTEM_ERROR", message: error.message }
        }, flags);
      } else {
        console.error(`FILE_SYSTEM_ERROR: ${error.message}`);
      }
      process.exit(1);
    }
  }
}

interface FileExistsError extends Error {
  code: "EEXIST";
}

function createFileExistsError(message: string): FileExistsError {
  const error = new Error(message) as FileExistsError;
  error.code = "EEXIST";
  return error;
}

export async function writeLocalFile(
  filePath: string,
  data: string,
  overwrite: boolean
): Promise<{ bytes: number }> {
  const dir = path.dirname(filePath);
  
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist, ignore error
  }
  
  try {
    const st = await fs.promises.stat(filePath);
    if (st.isFile() && !overwrite) {
      throw createFileExistsError("File exists; use --overwrite");
    }
  } catch (error) {
    // Only rethrow if it's not a "file not found" error
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  
  await fs.promises.writeFile(filePath, data, "utf8");
  return { bytes: Buffer.byteLength(data, "utf8") };
}

interface ContentQueryOptions {
  maxFiles?: number;
  maxBytes?: number;
}

export function buildContentQueryString(opts: ContentQueryOptions): string {
  const qs = new URLSearchParams();
  
  if (typeof opts.maxFiles === "number" && Number.isFinite(opts.maxFiles) && opts.maxFiles > 0) {
    qs.set("maxFiles", String(opts.maxFiles));
  }
  
  if (typeof opts.maxBytes === "number" && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0) {
    qs.set("maxBytes", String(opts.maxBytes));
  }
  
  const qsString = qs.toString();
  return qsString ? `/api/v1/content?${qsString}` : "/api/v1/content";
}