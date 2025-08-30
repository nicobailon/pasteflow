/** @jest-environment node */

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { PasteFlowAPIServer } from '../api-server';
import type { WorkspaceState, PreferenceValue } from '../db/database-implementation';

// Minimal in-memory fake database bridge matching the API-server's usage surface
class FakeDatabaseBridge {
  private workspaceIdSeq = 1;
  private workspaces = new Map<number, {
    id: number;
    name: string;
    folder_path: string;
    state: WorkspaceState;
    created_at: number;
    updated_at: number;
    last_accessed: number;
  }>();

  private instructions = new Map<string, {
    id: string;
    name: string;
    content: string;
    created_at: number;
    updated_at: number;
  }>();

  private prefs = new Map<string, PreferenceValue>();

  async listWorkspaces() {
    return [...this.workspaces.values()];
  }

  async createWorkspace(name: string, folderPath: string, state: WorkspaceState = {}) {
    // Enforce name uniqueness
    for (const ws of this.workspaces.values()) {
      if (ws.name === name) throw new Error(`Workspace with name '${name}' already exists`);
    }
    const now = Date.now();
    const id = this.workspaceIdSeq++;
    const row = {
      id,
      name,
      folder_path: folderPath,
      state,
      created_at: now,
      updated_at: now,
      last_accessed: now,
    };
    this.workspaces.set(id, row);
    return row;
  }

  async getWorkspace(nameOrId: string | number) {
    const key = String(nameOrId);
    const idNum = Number.isFinite(Number(key)) ? Number(key) : Number.NaN;
    if (!Number.isNaN(idNum)) {
      return this.workspaces.get(idNum) || null;
    }
    for (const ws of this.workspaces.values()) {
      if (ws.name === key) return ws;
    }
    return null;
  }

  async updateWorkspaceById(id: string, state: WorkspaceState) {
    const idNum = Number(id);
    const ws = this.workspaces.get(idNum);
    if (!ws) {
      throw new Error(`Workspace with id '${id}' not found`);
    }
    const now = Date.now();
    ws.state = state;
    ws.updated_at = now;
    this.workspaces.set(idNum, ws);
  }

  async deleteWorkspaceById(id: string) {
    const idNum = Number(id);
    this.workspaces.delete(idNum);
  }

  async renameWorkspace(oldName: string, newName: string) {
    // Ensure new name uniqueness
    for (const ws of this.workspaces.values()) {
      if (ws.name === newName) throw new Error(`Workspace with name '${newName}' already exists`);
    }
    let target: number | null = null;
    for (const [id, ws] of this.workspaces) {
      if (ws.name === oldName) {
        target = id;
        break;
      }
    }
    if (target === null) {
      throw new Error(`Workspace '${oldName}' not found`);
    }
    const entry = this.workspaces.get(target)!;
    entry.name = newName;
    entry.updated_at = Date.now();
    this.workspaces.set(target, entry);
  }

  async setPreference(key: string, value: PreferenceValue) {
    this.prefs.set(key, value ?? null);
  }

  async getPreference(key: string) {
    return this.prefs.get(key) ?? null;
  }

  async listInstructions() {
    return [...this.instructions.values()].sort((a, b) => b.updated_at - a.updated_at);
  }

  async createInstruction(id: string, name: string, content: string) {
    if (this.instructions.has(id)) {
      throw new Error(`Instruction '${id}' already exists`);
    }
    const now = Date.now();
    this.instructions.set(id, { id, name, content, created_at: now, updated_at: now });
  }

  async updateInstruction(id: string, name: string, content: string) {
    const row = this.instructions.get(id);
    if (!row) throw new Error(`Instruction '${id}' not found`);
    row.name = name;
    row.content = content;
    row.updated_at = Date.now();
    this.instructions.set(id, row);
  }

  async deleteInstruction(id: string) {
    this.instructions.delete(id);
  }
}

// Low-level HTTP helpers
function requestRaw(options: http.RequestOptions & { body?: string }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function requestJson<T = any>(
  method: string,
  port: number,
  pathName: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: T }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const opts: http.RequestOptions & { body?: string } = {
    hostname: '127.0.0.1',
    port,
    path: pathName,
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
    body: payload,
  };
  const { status, text } = await requestRaw(opts);
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status, json: parsed };
}

function withTempHome(testFn: (homeDir: string) => Promise<void>) {
  return async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-home-'));
    const spy = jest.spyOn(os, 'homedir').mockReturnValue(tmp);
    try {
      // Prepare ~/.pasteflow/auth.token
      const cfg = path.join(tmp, '.pasteflow');
      fs.mkdirSync(cfg, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(cfg, 'auth.token'), 'testtoken\n', { mode: 0o600 });
      await testFn(tmp);
    } finally {
      spy.mockRestore();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  };
}

// Wait for server to bind to an ephemeral port (when constructed with port=0)
async function waitForPort(srv: PasteFlowAPIServer, timeoutMs = 2000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = srv.getPort();
    if (typeof p === 'number' && p > 0) return p;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Server did not bind to a port in time');
}

describe('PasteFlowAPIServer — Phase 3 Selection & Aggregation', () => {
  jest.setTimeout(20_000);

  test('end-to-end: open → select → selected → content → export → clear', withTempHome(async () => {
    // Arrange server
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Arrange workspace and files
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ws-'));
    const textPath = path.join(workspaceDir, 'hello.txt');
    fs.writeFileSync(textPath, 'hello\nworld\n', 'utf8');
    const binPath = path.join(workspaceDir, 'image.png');
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 3])); // binary by ext

    // Open (creates/activates workspace and sets allowedPaths)
    let res = await requestJson('POST', port, '/api/v1/folders/open', 'testtoken', { folderPath: workspaceDir, name: 'ws3' });
    expect(res.status).toBe(200);
    expect((res.json as any).data?.folderPath).toBe(workspaceDir);

    // Select a text file (with lines) - existence check enforced
    res = await requestJson('POST', port, '/api/v1/files/select', 'testtoken', {
      items: [{ path: textPath, lines: [{ start: 1, end: 1 }] }]
    });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Verify /files/selected contains our file (sanitized absolute path)
    res = await requestJson('GET', port, '/api/v1/files/selected', 'testtoken');
    expect(res.status).toBe(200);
    const selected = (res.json as any).data as { path: string; lines?: { start: number; end: number }[] }[];
    expect(selected.length).toBe(1);

    // Aggregate content
    res = await requestJson('GET', port, '/api/v1/content', 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data?.fileCount).toBe(1);
    expect(((res.json as any).data?.content || '') as string).toContain('hello');

    // Export aggregated content inside workspace
    const outPath = path.join(workspaceDir, 'export.txt');
    res = await requestJson('POST', port, '/api/v1/content/export', 'testtoken', { outputPath: outPath, overwrite: true });
    expect(res.status).toBe(200);
    const bytes = (res.json as any).data?.bytes as number;
    expect(bytes).toBeGreaterThan(0);
    expect(fs.existsSync(outPath)).toBe(true);

    // Clear selection
    res = await requestJson('POST', port, '/api/v1/files/clear', 'testtoken', {});
    expect(res.status).toBe(200);
    res = await requestJson('GET', port, '/api/v1/files/selected', 'testtoken');
    expect((res.json as any).data.length).toBe(0);

    server.close();
  }));

  test('no active workspace → 400 NO_ACTIVE_WORKSPACE on /files/select', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    const somePath = path.join(os.tmpdir(), 'pf-non-ws', 'file.txt');
    const res = await requestJson('POST', port, '/api/v1/files/select', 'testtoken', {
      items: [{ path: somePath, lines: [{ start: 1, end: 1 }] }]
    });
    expect(res.status).toBe(400);
    expect((res.json as any)?.error?.code).toBe('NO_ACTIVE_WORKSPACE');

    server.close();
  }));

  test('PATH_DENIED when selecting a file outside workspace', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Open workspace A
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ws-'));
    fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'a', 'utf8');
    let res = await requestJson('POST', port, '/api/v1/folders/open', 'testtoken', { folderPath: workspaceDir, name: 'wsA' });
    expect(res.status).toBe(200);
    expect((res.json as any).data?.name).toBe('wsA');

    // Attempt to select a file in a different temp directory → outside allowedPaths
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-out-'));
    const outsideFile = path.join(outsideDir, 'b.txt');
    fs.writeFileSync(outsideFile, 'b', 'utf8');

    res = await requestJson('POST', port, '/api/v1/files/select', 'testtoken', {
      items: [{ path: outsideFile }]
    });
    expect(res.status).toBe(403);
    expect((res.json as any)?.error?.code).toBe('PATH_DENIED');

    server.close();
  }));

  test('FILE_NOT_FOUND when selecting a missing file inside workspace', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Open workspace
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ws-'));
    let res = await requestJson('POST', port, '/api/v1/folders/open', 'testtoken', { folderPath: workspaceDir, name: 'wsB' });
    expect(res.status).toBe(200);
    expect((res.json as any).data?.name).toBe('wsB');

    // Missing file under workspace
    const missing = path.join(workspaceDir, 'missing.txt');
    res = await requestJson('POST', port, '/api/v1/files/select', 'testtoken', {
      items: [{ path: missing }]
    });
    expect(res.status).toBe(404);
    expect((res.json as any)?.error?.code).toBe('FILE_NOT_FOUND');

    server.close();
  }));

  test('partial deselect on whole-file selection → 400 VALIDATION_ERROR', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Open workspace and create a file
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ws-'));
    const file = path.join(workspaceDir, 'x.txt');
    fs.writeFileSync(file, 'line1\nline2\n', 'utf8');

    // Activate
    let res = await requestJson('POST', port, '/api/v1/folders/open', 'testtoken', { folderPath: workspaceDir, name: 'wsX' });
    expect(res.status).toBe(200);
    expect((res.json as any).data?.folderPath).toBe(workspaceDir);

    // Select whole-file (no lines)
    res = await requestJson('POST', port, '/api/v1/files/select', 'testtoken', { items: [{ path: file }] });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Attempt partial deselect → service throws, API returns 400 VALIDATION_ERROR
    res = await requestJson('POST', port, '/api/v1/files/deselect', 'testtoken', {
      items: [{ path: file, lines: [{ start: 1, end: 1 }] }]
    });
    expect(res.status).toBe(400);
    expect((res.json as any)?.error?.code).toBe('VALIDATION_ERROR');

    server.close();
  }));
});