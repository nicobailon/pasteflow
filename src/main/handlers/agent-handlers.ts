import path from 'node:path';
import fs from 'node:fs';

import type { Request, Response } from 'express';
import { z } from 'zod';

import { ok, toApiError } from '../error-normalizer';
import { validateAndResolvePath } from '../file-service';
import type { DatabaseBridge } from '../db/database-bridge';

export async function handleAgentExportSession(deps: { db: DatabaseBridge }, req: Request, res: Response) {
  const Body = z.object({ id: z.string().min(1), outPath: z.string().optional(), download: z.boolean().optional() });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(toApiError('VALIDATION_ERROR', 'Invalid body'));
  try {
    const id = parsed.data.id;
    const row = await deps.db.getChatSession(id);
    if (!row) return res.status(404).json(toApiError('NOT_FOUND', 'Session not found'));
    const tools = await deps.db.listToolExecutions(id);
    const usage = await deps.db.listUsageSummaries(id);
    const approvalsExport = await deps.db.listApprovalsForExport(id);
    const parseJson = (value: string | null) => {
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };
    const approvalPreviews = approvalsExport.previews.map((preview) => ({
      ...preview,
      detail: parseJson(preview.detail),
      args: parseJson(preview.args),
    }));
    const approvalRows = approvalsExport.approvals.map((approval) => ({
      ...approval,
      feedback_meta: parseJson(approval.feedback_meta),
    }));
    const payload = {
      session: row,
      toolExecutions: tools,
      usage,
      approvals: {
        previews: approvalPreviews,
        approvals: approvalRows,
      },
    };
    const outPath = parsed.data.outPath;
    if (parsed.data.download === true) {
      return res.json(ok(payload));
    }
    if (outPath && outPath.trim().length > 0) {
      const val = validateAndResolvePath(outPath);
      if (!val.ok) {
        if (val.code === 'NO_ACTIVE_WORKSPACE') {
          return res.status(400).json(toApiError('NO_ACTIVE_WORKSPACE', val.message));
        }
        if (val.code === 'PATH_DENIED') {
          return res.status(403).json(toApiError('PATH_DENIED', 'Access denied'));
        }
        return res.status(400).json(toApiError('VALIDATION_ERROR', val.message));
      }
      await fs.promises.writeFile(val.absolutePath, JSON.stringify(payload, null, 2), 'utf8');
      return res.json(ok({ file: val.absolutePath }));
    }
    try {
      const mod = await import('electron');
      const file = path.join(mod.app.getPath('downloads'), `pasteflow-session-${id}.json`);
      await fs.promises.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
      return res.json(ok({ file }));
    } catch {
      return res.json(ok(payload));
    }
  } catch (error) {
    return res.status(500).json(toApiError('DB_OPERATION_FAILED', (error as Error).message));
  }
}
