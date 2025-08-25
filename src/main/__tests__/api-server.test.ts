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

describe('PasteFlowAPIServer — Day 3 endpoints and error handling', () => {
  jest.setTimeout(20_000);

  test('rejects unauthorized requests with 401', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    const { status } = await requestJson('GET', port, '/api/v1/health', 'invalid');
    expect(status).toBe(401);

    server.close();
  }));

  test('health returns ok with valid auth', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    const { status, json } = await requestJson('GET', port, '/api/v1/health', 'testtoken');
    expect(status).toBe(200);
    expect(json?.data?.status).toBe('ok');

    server.close();
  }));

  test('workspaces CRUD + status allowedPaths fallback', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Create
    const createBody = { name: 'ws1', folderPath: '/tmp/ws1', state: { selectedFiles: [] } };
    let res = await requestJson('POST', port, '/api/v1/workspaces', 'testtoken', createBody);
    expect(res.status).toBe(200);
    const created = (res.json as any).data;
    expect(created?.id).toBeDefined();
    const id = created.id as string;

    // List
    res = await requestJson('GET', port, '/api/v1/workspaces', 'testtoken');
    expect(res.status).toBe(200);
    expect(Array.isArray((res.json as any).data)).toBe(true);
    expect((res.json as any).data.length).toBe(1);

    // Get by id
    res = await requestJson('GET', port, `/api/v1/workspaces/${id}`, 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data?.name).toBe('ws1');

    // Update by id
    const newState: WorkspaceState = { selectedFiles: [{ path: 'file1.txt' }] };
    res = await requestJson('PUT', port, `/api/v1/workspaces/${id}`, 'testtoken', { state: newState });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Rename by id
    res = await requestJson('POST', port, `/api/v1/workspaces/${id}/rename`, 'testtoken', { newName: 'ws1-renamed' });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Load (sets active and allowedPaths)
    res = await requestJson('POST', port, `/api/v1/workspaces/${id}/load`, 'testtoken', {});
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Status reflects active workspace and allowedPaths fallback
    res = await requestJson('GET', port, '/api/v1/status', 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data?.activeWorkspace?.id).toBe(id);
    expect((res.json as any).data?.securityContext?.allowedPaths).toContain('/tmp/ws1');

    // Delete
    res = await requestJson('DELETE', port, `/api/v1/workspaces/${id}`, 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Get after delete returns null
    res = await requestJson('GET', port, `/api/v1/workspaces/${id}`, 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(null);

    server.close();
  }));

  test('instructions CRUD with server-generated id when omitted', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Create (no id provided)
    let res = await requestJson('POST', port, '/api/v1/instructions', 'testtoken', { name: 'i1', content: 'hello' });
    expect(res.status).toBe(200);
    const created = (res.json as any).data;
    expect(created?.id).toBeDefined();
    const id = created.id as string;

    // List
    res = await requestJson('GET', port, '/api/v1/instructions', 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data.length).toBe(1);

    // Update
    res = await requestJson('PUT', port, `/api/v1/instructions/${id}`, 'testtoken', { name: 'i1-new', content: 'updated' });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Delete
    res = await requestJson('DELETE', port, `/api/v1/instructions/${id}`, 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // List empty
    res = await requestJson('GET', port, '/api/v1/instructions', 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data.length).toBe(0);

    server.close();
  }));

  test('preferences get/set', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Set
    let res = await requestJson('PUT', port, '/api/v1/prefs/ui.theme', 'testtoken', { value: 'dark' });
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe(true);

    // Get
    res = await requestJson('GET', port, '/api/v1/prefs/ui.theme', 'testtoken');
    expect(res.status).toBe(200);
    expect((res.json as any).data).toBe('dark');

    server.close();
  }));

  test('invalid JSON yields 400 VALIDATION_ERROR (auth-first)', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    const { status, text } = await requestRaw({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/workspaces',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer testtoken',
        'Content-Type': 'application/json',
      },
      body: '{ invalid json',
    });
    expect(status).toBe(400);
    const parsed = JSON.parse(text);
    expect(parsed?.error?.code).toBe('VALIDATION_ERROR');

    server.close();
  }));

  test('invalid request body returns 400 VALIDATION_ERROR', withTempHome(async () => {
    const db = new FakeDatabaseBridge();
    const server = new PasteFlowAPIServer(db as unknown as any, 0);
    server.start();
    const port = await waitForPort(server);

    // Missing name/content
    const res = await requestJson('POST', port, '/api/v1/instructions', 'testtoken', { bad: 'payload' });
    expect(res.status).toBe(400);
    expect((res.json as any)?.error?.code).toBe('VALIDATION_ERROR');

    server.close();
  }));
});