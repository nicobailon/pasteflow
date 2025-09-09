import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceRef } from '../main/agent/chat-storage';

describe('chat-storage pathing and load/save', () => {
  it('writes and loads thread within userData/.agent-threads/<wsKey> and lists it', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-threads-'));
    jest.resetModules();
    // Mock electron.app.getPath to point to tmpRoot before importing module under test
    jest.doMock('electron', () => ({ app: { getPath: () => tmpRoot } }), { virtual: true });

    const mod = await import('../main/agent/chat-storage');

    const ws: WorkspaceRef = { id: 'ws1', name: 'WS', folderPath: '/abs/repo' };
    // Save a minimal snapshot
    const res = await mod.saveSnapshot({ sessionId: 'abc', workspace: ws, messages: [{ role: 'user', content: 'hi' }] });
    expect('ok' in res && res.ok).toBe(true);

    const loaded = await mod.loadThreadInWorkspace(ws, 'abc');
    expect(loaded?.sessionId).toBe('abc');
    expect(Array.isArray(loaded?.messages)).toBe(true);

    const list = await mod.listThreads(ws);
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((t) => t.sessionId === 'abc')).toBe(true);
  });
});

