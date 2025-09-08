import type { Request, Response } from 'express';

import { ok, toApiError } from '../error-normalizer';
import { getAllowedWorkspacePaths } from '../workspace-context';
import { validateAndResolvePath, statFile as fileServiceStatFile, readTextFile } from '../file-service';
import { getMainTokenService } from '../../services/token-service-main';

import type { DatabaseBridge } from '../db/database-bridge';
import { filePathQuery } from './schemas';

export async function handleFileInfo(_deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const validation = await validateFilePath(req, res);
  if (!validation) return;

  const s = await fileServiceStatFile(validation.absolutePath);
  if (!s.ok) {
    return handleFileError(s, res);
  }
  return res.json(ok(s.data));
}

export async function handleFileContent(_deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const validation = await validateFilePath(req, res);
  if (!validation) return;

  const s = await fileServiceStatFile(validation.absolutePath);
  if (!s.ok) {
    return handleFileError(s, res);
  }

  if (s.data.isDirectory) {
    return res.status(400).json(toApiError('VALIDATION_ERROR', 'Path is a directory'));
  }
  if (s.data.isBinary) {
    return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
  }

  const r = await readTextFile(validation.absolutePath);
  if (!r.ok) {
    return handleReadError(r, res);
  }

  if (r.isLikelyBinary) {
    return res.status(409).json(toApiError('BINARY_FILE', 'File contains binary data'));
  }

  const tokenService = getMainTokenService();
  const { count } = await tokenService.countTokens(r.content);
  return res.json(ok({ content: r.content, tokenCount: count, fileType: s.data.fileType || 'plaintext' }));
}

async function validateFilePath(req: Request, res: Response) {
  const q = filePathQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid query'));
    return null;
  }

  const allowed = getAllowedWorkspacePaths();
  if (!allowed || allowed.length === 0) {
    res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', 'No active workspace'));
    return null;
  }

  const val = validateAndResolvePath(String(q.data.path));
  if (!val.ok) {
    handlePathValidationError(val, res);
    return null;
  }

  return val;
}

function handlePathValidationError(val: { ok: false; code: string; message: string }, res: Response) {
  if (val.code === 'NO_ACTIVE_WORKSPACE') {
    res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
  } else if (val.code === 'PATH_DENIED') {
    res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
  } else {
    res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
  }
}

function handleFileError(s: { ok: false; code: string; message: string }, res: Response) {
  if (s.code === 'FILE_NOT_FOUND') {
    return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
  }
  if (s.code === 'FILE_SYSTEM_ERROR') {
    return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', s.message));
  }
  return res.status(500).json(toApiError('DB_OPERATION_FAILED', s.message));
}

function handleReadError(r: { ok: false; code: string; message: string }, res: Response) {
  if (r.code === 'FILE_NOT_FOUND') {
    return res.status(404).json(toApiError('FILE_NOT_FOUND', 'File not found'));
  }
  if (r.code === 'BINARY_FILE') {
    return res.status(409).json(toApiError('BINARY_FILE', r.message));
  }
  if (r.code === 'VALIDATION_ERROR') {
    return res.status(400).json(toApiError('VALIDATION_ERROR', r.message));
  }
  if (r.code === 'FILE_SYSTEM_ERROR') {
    return res.status(500).json(toApiError('FILE_SYSTEM_ERROR', r.message));
  }
  return res.status(500).json(toApiError('DB_OPERATION_FAILED', r.message));
}
