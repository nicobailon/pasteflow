import fs from 'node:fs';
import path from 'node:path';

import { FILE_PROCESSING } from '../constants';
import { getPathValidator } from '../security/path-validator';
import { isBinaryExtension, isLikelyBinaryContent } from '../file-ops/filters';
import { getFileType } from '../utils/content-formatter';

import { getAllowedWorkspacePaths } from './workspace-context';
import type { ApiErrorCode } from './error-normalizer';

export type ValidateAndResolvePathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; code: ApiErrorCode; message: string; reason?: string };

export type StatFileData = {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isBinary: boolean;
  mtimeMs: number;
  fileType: string | null;
};

export type StatFileResult =
  | { ok: true; data: StatFileData }
  | { ok: false; code: ApiErrorCode; message: string };

export type ReadTextFileResult =
  | { ok: true; content: string; isLikelyBinary: boolean }
  | { ok: false; code: ApiErrorCode; message: string };

// Keep special extensions aligned with main process behavior (src/main/main.ts)
const SPECIAL_FILE_EXTENSIONS = new Set<string>(['.asar', '.bin', '.dll', '.exe', '.so', '.dylib']);

function isSpecialFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SPECIAL_FILE_EXTENSIONS.has(ext);
}

function toValidationError(message: string, reason?: string): ValidateAndResolvePathResult {
  return { ok: false, code: 'VALIDATION_ERROR', message, reason };
}

/**
 * Validate an input path against current PathValidator workspace context and return a normalized absolute path.
 * - Requires an active workspace (allowedPaths must be non-empty) or returns NO_ACTIVE_WORKSPACE.
 * - Applies allow-first logic via PathValidator singleton.
 */
export function validateAndResolvePath(inputPath: string): ValidateAndResolvePathResult {
  const allowed = getAllowedWorkspacePaths();
  if (!allowed || allowed.length === 0) {
    return { ok: false, code: 'NO_ACTIVE_WORKSPACE', message: 'No active workspace selected' };
  }

  if (!inputPath || typeof inputPath !== 'string') {
    return toValidationError('Path must be a non-empty string', 'INVALID_INPUT');
  }

  const validator = getPathValidator();
  const result = validator.validatePath(inputPath);

  if (!result.valid) {
    const reason = result.reason || 'UNKNOWN';
    if (reason === 'OUTSIDE_WORKSPACE' || reason === 'BLOCKED_PATH') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path is outside allowed workspace or blocked', reason };
    }
    return toValidationError('Invalid path', reason);
  }

  const absolutePath = result.sanitizedPath!;
  return { ok: true, absolutePath };
}

/**
 * Stat a file or directory and return metadata including binary identification and language fileType guess.
 */
export async function statFile(absolutePath: string): Promise<StatFileResult> {
  try {
    const st = await fs.promises.stat(absolutePath);
    const name = path.basename(absolutePath);
    const isDirectory = st.isDirectory();
    const mtimeMs = st.mtimeMs;

    if (isDirectory) {
      return {
        ok: true,
        data: {
          name,
          path: absolutePath,
          size: 0,
          isDirectory: true,
          isBinary: false,
          mtimeMs,
          fileType: null,
        },
      };
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const binaryByExt = isBinaryExtension(ext) || isSpecialFile(absolutePath);

    return {
      ok: true,
      data: {
        name,
        path: absolutePath,
        size: st.size,
        isDirectory: false,
        isBinary: binaryByExt,
        mtimeMs,
        fileType: getFileType(name),
      },
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, code: 'FILE_NOT_FOUND', message: 'File not found' };
    }
    return { ok: false, code: 'FILE_SYSTEM_ERROR', message: (error as Error)?.message || String(error) };
  }
}

/**
 * Read a text file with size checks and binary heuristics.
 * - Enforces FILE_PROCESSING.MAX_FILE_SIZE_BYTES
 * - Uses isLikelyBinaryContent heuristic; caller must convert to error if true
 */
export async function readTextFile(absolutePath: string): Promise<ReadTextFileResult> {
  try {
    const st = await fs.promises.stat(absolutePath);
    if (st.isDirectory()) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Path is a directory, not a file' };
    }

    if (st.size > FILE_PROCESSING.MAX_FILE_SIZE_BYTES) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `File exceeds size limit (${st.size} bytes > ${FILE_PROCESSING.MAX_FILE_SIZE_BYTES})`,
      };
    }

    // Quick refuse for special/binary extensions to avoid heavy reads
    const ext = path.extname(absolutePath).toLowerCase();
    if (isSpecialFile(absolutePath) || isBinaryExtension(ext)) {
      return { ok: false, code: 'BINARY_FILE', message: 'File contains binary data' };
    }

    const content = await fs.promises.readFile(absolutePath, 'utf8');
    const looksBinary = isLikelyBinaryContent(content, absolutePath);
    return { ok: true, content, isLikelyBinary: looksBinary };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, code: 'FILE_NOT_FOUND', message: 'File not found' };
    }
    return { ok: false, code: 'FILE_SYSTEM_ERROR', message: (error as Error)?.message || String(error) };
  }
}

export type WriteTextFileResult =
  | { ok: true; bytes: number }
  | { ok: false; code: ApiErrorCode; message: string };

/**
 * Safely write UTF-8 text to a file, creating parent directories as needed.
 */
export async function writeTextFile(absolutePath: string, content: string): Promise<WriteTextFileResult> {
  try {
    const dir = path.dirname(absolutePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(absolutePath, content, 'utf8');
    return { ok: true, bytes: Buffer.byteLength(content, 'utf8') };
  } catch (error: unknown) {
    return { ok: false, code: 'FILE_SYSTEM_ERROR', message: (error as Error)?.message || String(error) };
  }
}

export type DeletePathResult =
  | { ok: true; removed: 'file'; bytes?: number }
  | { ok: false; code: ApiErrorCode; message: string };

/** Remove a file from disk. Directories are rejected to reduce accidental wipes. */
export async function deletePath(absolutePath: string): Promise<DeletePathResult> {
  try {
    const st = await fs.promises.stat(absolutePath);
    if (st.isDirectory()) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Deleting directories is not supported' };
    }
    await fs.promises.unlink(absolutePath);
    return { ok: true, removed: 'file', bytes: st.size };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return { ok: false, code: 'FILE_NOT_FOUND', message: 'File not found' };
    }
    return { ok: false, code: 'FILE_SYSTEM_ERROR', message: (error as Error)?.message || String(error) };
  }
}

export type MovePathResult =
  | { ok: true; bytes?: number }
  | { ok: false; code: ApiErrorCode; message: string };

/** Move/rename a file, creating parent folders at the destination. */
export async function movePath(fromAbsolute: string, toAbsolute: string): Promise<MovePathResult> {
  try {
    const st = await fs.promises.stat(fromAbsolute);
    if (st.isDirectory()) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Moving directories is not supported' };
    }
    const dir = path.dirname(toAbsolute);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.rename(fromAbsolute, toAbsolute);
    return { ok: true, bytes: st.size };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      const isFromMissing = err.path === fromAbsolute || err.message?.includes(fromAbsolute);
      if (isFromMissing) {
        return { ok: false, code: 'FILE_NOT_FOUND', message: 'Source file not found' };
      }
    }
    return { ok: false, code: 'FILE_SYSTEM_ERROR', message: (error as Error)?.message || String(error) };
  }
}
