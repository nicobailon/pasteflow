import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

type UIMessage = any; // `@ai-sdk/react` UI message object; kept loose for Phase 1

export type WorkspaceRef = {
  id: string;
  name: string;
  folderPath: string;
};

export type AgentThreadListItem = {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  filePath: string;
};

export type AgentThreadFileV1 = {
  version: 1;
  sessionId: string;
  workspace: WorkspaceRef;
  meta: {
    title: string;
    createdAt: number;
    updatedAt: number;
    model?: string;
    provider?: string;
    messageCount: number;
  };
  messages: UIMessage[];
  toolExecutions?: any[];
  usage?: any[];
};

const THREADS_DIR_NAME = ".agent-threads";

export function getThreadsRoot(): string {
  return path.join(app.getPath("userData"), THREADS_DIR_NAME);
}

export function getWorkspaceKey(ws: WorkspaceRef): string {
  const raw = (ws && typeof ws.id === "string" && ws.id.trim().length > 0)
    ? String(ws.id)
    : safeSha1(ws.folderPath || ws.name || randomUUID());
  // Make filename/dir-safe: allow alnum, dash, underscore
  return raw.replace(/[^\w-]/g, "-");
}

export function getWorkspaceDir(ws: WorkspaceRef): string {
  return path.join(getThreadsRoot(), getWorkspaceKey(ws));
}

// Note: all directories in this module are created via async fs.promises.mkdir

function isWithinRoot(p: string, root: string): boolean {
  const rp = path.resolve(p);
  const rr = path.resolve(root);
  return rp === rr || rp.startsWith(rr + path.sep);
}

function safeSha1(input: string): string {
  return createHash("sha1").update(String(input)).digest("hex");
}

async function safeWriteJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const payload = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, payload, "utf8");
  await fs.promises.rename(tmp, filePath);
}

export function getThreadFilePath(ws: WorkspaceRef, sessionId: string): string {
  const fileName = `thread-${sessionId}.json`;
  return path.join(getWorkspaceDir(ws), fileName);
}

export async function listThreads(ws: WorkspaceRef): Promise<AgentThreadListItem[]> {
  const root = getThreadsRoot();
  const wdir = getWorkspaceDir(ws);
  const results: AgentThreadListItem[] = [];
  try {
    await fs.promises.mkdir(wdir, { recursive: true });
    const files = await fs.promises.readdir(wdir);
    for (const f of files) {
      if (!f.startsWith("thread-") || !f.endsWith(".json")) continue;
      const fp = path.join(wdir, f);
      if (!isWithinRoot(fp, root)) continue;
      try {
        const raw = await fs.promises.readFile(fp, "utf8");
        const parsed = JSON.parse(raw) as Partial<AgentThreadFileV1>;
        const sessionId = String(parsed.sessionId || f.replace(/^thread-|\.json$/g, ""));
        const title = String(parsed.meta?.title || "Untitled");
        const createdAt = Number(parsed.meta?.createdAt || Date.now());
        const updatedAt = Number(parsed.meta?.updatedAt || createdAt);
        const messageCount = Number(parsed.meta?.messageCount ?? (Array.isArray(parsed.messages) ? parsed.messages.length : 0));
        results.push({ sessionId, title, createdAt, updatedAt, messageCount, filePath: fp });
      } catch {
        // skip unreadable or malformed files
      }
    }
  } catch {
    // if directory missing or unreadable, return empty list
  }
  // Sort by updatedAt desc
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results;
}

export async function loadThread(sessionId: string): Promise<AgentThreadFileV1 | null> {
  const root = getThreadsRoot();
  // Scan workspace dirs for the file
  let target: string | null = null;
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const fp = path.join(root, dirent.name, `thread-${sessionId}.json`);
      if (isWithinRoot(fp, root)) {
        try {
          await fs.promises.access(fp, fs.constants.R_OK);
          target = fp; break;
        } catch {
          // not found in this workspace
        }
      }
    }
  } catch {
    // root may not exist yet
  }
  if (!target) return null;
  const raw = await fs.promises.readFile(target, "utf8");
  const parsed = JSON.parse(raw);
  return parsed as AgentThreadFileV1;
}

export async function loadThreadInWorkspace(ws: WorkspaceRef, sessionId: string): Promise<AgentThreadFileV1 | null> {
  const root = getThreadsRoot();
  const fp = getThreadFilePath(ws, sessionId);
  if (!isWithinRoot(fp, root)) return null;
  try {
    await fs.promises.access(fp, fs.constants.R_OK);
  } catch {
    return null;
  }
  const raw = await fs.promises.readFile(fp, "utf8");
  const parsed = JSON.parse(raw);
  return parsed as AgentThreadFileV1;
}

export async function deleteThread(sessionId: string): Promise<boolean> {
  const root = getThreadsRoot();
  let deleted = false;
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const fp = path.join(root, dirent.name, `thread-${sessionId}.json`);
      if (!isWithinRoot(fp, root)) continue;
      try {
        await fs.promises.unlink(fp);
        deleted = true;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return deleted;
}

export async function deleteThreadInWorkspace(ws: WorkspaceRef, sessionId: string): Promise<boolean> {
  const root = getThreadsRoot();
  const fp = getThreadFilePath(ws, sessionId);
  if (!isWithinRoot(fp, root)) return false;
  try {
    await fs.promises.unlink(fp);
    return true;
  } catch {
    return false;
  }
}

export async function renameThread(sessionId: string, title: string): Promise<boolean> {
  const thread = await loadThread(sessionId);
  if (!thread) return false;
  const updated: AgentThreadFileV1 = {
    ...thread,
    meta: {
      ...thread.meta,
      title: title.trim() || thread.meta.title,
      updatedAt: Date.now(),
    },
  };
  const ws = thread.workspace;
  const fp = getThreadFilePath(ws, sessionId);
  await safeWriteJsonAtomic(fp, updated);
  return true;
}

export async function renameThreadInWorkspace(ws: WorkspaceRef, sessionId: string, title: string): Promise<boolean> {
  const root = getThreadsRoot();
  const fp = getThreadFilePath(ws, sessionId);
  if (!isWithinRoot(fp, root)) return false;
  let existing: AgentThreadFileV1 | null = null;
  try {
    const raw = await fs.promises.readFile(fp, 'utf8');
    existing = JSON.parse(raw) as AgentThreadFileV1;
  } catch {
    existing = null;
  }
  if (!existing) return false;
  const updated: AgentThreadFileV1 = {
    ...existing,
    meta: {
      ...existing.meta,
      title: title.trim() || existing.meta.title,
      updatedAt: Date.now(),
    },
  };
  await safeWriteJsonAtomic(fp, updated);
  return true;
}

function deriveTitleFromMessages(messages: UIMessage[]): string {
  try {
    // Attempt to find first user message content
    const firstUser = (messages || []).find((m: any) => m && (m.role === "user" || m.role === "USER"));
    if (!firstUser) return "New Chat";
    const content = (firstUser as any).content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as any;
      text = String(first?.text ?? first?.content ?? "");
    } else if (content && typeof content === "object") {
      text = String((content as any).text ?? (content as any).content ?? "");
    }
    const line = text.split(/\r?\n/)[0] || "New Chat";
    return line.trim().slice(0, 140) || "New Chat";
  } catch {
    return "New Chat";
  }
}

export async function saveSnapshot(input: {
  sessionId: string;
  workspace: WorkspaceRef;
  messages: UIMessage[];
  meta?: Partial<AgentThreadFileV1["meta"]>;
}): Promise<{ ok: true; filePath: string; created: boolean } | { ok: false; error: string }> {
  const { sessionId, workspace, messages, meta: rawMeta } = input;
  const metaInput = rawMeta ?? {};
  const root = getThreadsRoot();
  const fp = getThreadFilePath(workspace, sessionId);
  if (!isWithinRoot(fp, root)) {
    return { ok: false, error: "PATH_OUT_OF_ROOT" };
  }

  // Clamp message count to env cap
  const capRaw = process.env.PF_AGENT_MAX_SESSION_MESSAGES;
  const cap = capRaw ? Math.max(1, Number(capRaw)) : 100;
  const truncated = Array.isArray(messages) && messages.length > cap
    ? messages.slice(-cap)
    : (Array.isArray(messages) ? messages : []);

  // Attempt to load existing thread for metadata reuse
  let existing: AgentThreadFileV1 | null = null;
  try {
    const raw = await fs.promises.readFile(fp, "utf8");
    existing = JSON.parse(raw) as AgentThreadFileV1;
  } catch {
    existing = null;
  }

  const now = Date.now();
  const created = !existing;
  const createdAt = existing?.meta.createdAt ?? now;
  const baseTitle = existing?.meta.title ?? deriveTitleFromMessages(truncated);
  const title = String(metaInput.title ?? baseTitle);
  const model = metaInput.model ?? existing?.meta.model;
  const provider = metaInput.provider ?? existing?.meta.provider;
  const messageCount = truncated.length;

  const { id: workspaceId, name: workspaceName, folderPath } = workspace;

  const toWrite: AgentThreadFileV1 = {
    version: 1,
    sessionId,
    workspace: { id: workspaceId, name: workspaceName, folderPath },
    meta: {
      title,
      createdAt,
      updatedAt: now,
      model,
      provider,
      messageCount,
    },
    messages: truncated,
    toolExecutions: existing?.toolExecutions,
    usage: existing?.usage,
  };

  await safeWriteJsonAtomic(fp, toWrite);
  return { ok: true, filePath: fp, created };
}

type FeedbackAppendOptions = {
  readonly resolvedBy?: string | null;
  readonly meta?: unknown;
};

function isFeedbackOptions(value: unknown): value is FeedbackAppendOptions {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, "resolvedBy") ||
    Object.prototype.hasOwnProperty.call(record, "meta")
  );
}

export async function appendApprovalFeedbackMessage(sessionId: string, approvalId: string, text: string, metaOrOptions?: unknown): Promise<void> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return;

  const thread = await loadThread(sessionId);
  if (!thread) return;

  const options: FeedbackAppendOptions = isFeedbackOptions(metaOrOptions)
    ? metaOrOptions as FeedbackAppendOptions
    : { meta: metaOrOptions };

  const workspace = thread.workspace;
  if (!workspace || typeof workspace !== "object") return;

  const root = getThreadsRoot();
  const fp = getThreadFilePath(workspace as WorkspaceRef, sessionId);
  if (!isWithinRoot(fp, root)) return;

  const now = Date.now();
  const messages = Array.isArray(thread.messages) ? [...thread.messages] : [];

  const feedbackMessage: Record<string, unknown> = {
    id: `approval-feedback-${approvalId}-${now}`,
    role: "user",
    name: (typeof options.resolvedBy === "string" && options.resolvedBy.trim().length > 0) ? options.resolvedBy.trim() : "reviewer",
    content: trimmed,
    createdAt: now,
    metadata: {
      kind: "approval-feedback",
      approvalId,
      resolvedBy: options.resolvedBy ?? null,
      meta: options.meta ?? null,
    },
  };

  messages.push(feedbackMessage);

  const updated: AgentThreadFileV1 = {
    ...thread,
    messages,
    meta: {
      ...thread.meta,
      updatedAt: now,
      messageCount: messages.length,
    },
  };

  await safeWriteJsonAtomic(fp, updated);
}
