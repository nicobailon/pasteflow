import type { BroadcastHelperTestExports } from '../broadcast-helper';

const loadModule = (): BroadcastHelperTestExports => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, unicorn/prefer-module
  const mod = require('../../main/broadcast-helper') as BroadcastHelperTestExports;
  mod.__resetBroadcastStateForTests();
  return mod;
};

describe('broadcast-helper', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('broadcastToRenderers is no-op without electron', () => {
    const mod = loadModule();
    mod.__setBrowserWindowForTests(null);
    expect(() => mod.broadcastToRenderers('test-channel', { a: 1 })).not.toThrow();
  });

  test('broadcastToRenderers sends to all windows and ignores per-window errors', () => {
    const sendOk = jest.fn();
    const sendFail = jest.fn(() => { throw new Error('boom'); });
    const mod = loadModule();
    mod.__setBrowserWindowForTests({
      getAllWindows: () => [
        { webContents: { send: sendOk } },
        { webContents: { send: sendFail } },
      ],
    });
    mod.broadcastToRenderers('ch', { x: 1 });
    expect(sendOk).toHaveBeenCalledWith('ch', { x: 1 });
    expect(sendFail).toHaveBeenCalled();
  });

  test('broadcastWorkspaceUpdated debounces and sequences', () => {
    const captured: any[] = [];
    const mod = loadModule();
    mod.__setBrowserWindowForTests({
      getAllWindows: () => [{ webContents: { send: (_ch: string, payload?: unknown) => captured.push(payload) } }],
    });

    mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [] });
    mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [{ path: '/x' }] as any });
    mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [{ path: '/y' }] as any });

    expect(captured.length).toBe(0);
    jest.advanceTimersByTime(110);

    expect(captured.length).toBe(1);
    const payload = captured[0] as any;
    expect(payload.workspaceId).toBe('w1');
    expect(payload.folderPath).toBe('/tmp/a');
    expect(Array.isArray(payload.selectedFiles)).toBe(true);
    expect(typeof payload.sequence).toBe('number');
    expect(typeof payload.timestamp).toBe('number');

    mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [] });
    jest.advanceTimersByTime(110);
    expect(captured.length).toBe(2);
    const payload2 = captured[1] as any;
    expect(payload2.sequence).toBeGreaterThan(payload.sequence);
  });

  test('rate limiting drops excessive events within 1 second window', () => {
    const sends: { ch: string; payload: unknown }[] = [];
    const mod = loadModule();
    mod.__setBrowserWindowForTests({
      getAllWindows: () => [{ webContents: { send: (ch: string, payload?: unknown) => sends.push({ ch, payload }) } }],
    });
    mod.__setBroadcastConfigForTests({ DEBOUNCE_MS: 5, MAX_EVENTS_PER_SECOND: 3 });

    for (let i = 0; i < 10; i++) {
      mod.broadcastToRenderers('test-rate', { i });
    }
    expect(sends.length).toBeLessThanOrEqual(3);

    jest.advanceTimersByTime(1000);
    for (let i = 0; i < 2; i++) {
      mod.broadcastToRenderers('test-rate', { i: `after-${i}` });
    }
    expect(sends.length).toBeGreaterThanOrEqual(4);
  });
});
