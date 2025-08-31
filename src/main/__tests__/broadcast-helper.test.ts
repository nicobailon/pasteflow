describe('broadcast-helper', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('broadcastToRenderers is no-op without electron', async () => {
    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import('../../main/broadcast-helper');
        expect(() => mod.broadcastToRenderers('test-channel', { a: 1 })).not.toThrow();
        resolve();
      });
    });
  });

  test('broadcastToRenderers sends to all windows and ignores per-window errors', async () => {
    const sendOk = jest.fn();
    const sendFail = jest.fn(() => { throw new Error('boom'); });

    jest.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [
          { webContents: { send: sendOk } },
          { webContents: { send: sendFail } },
        ],
      },
    }), { virtual: true });

    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import('../../main/broadcast-helper');
        mod.broadcastToRenderers('ch', { x: 1 });
        expect(sendOk).toHaveBeenCalledWith('ch', { x: 1 });
        // second throws but should not affect others
        expect(sendFail).toHaveBeenCalled();
        resolve();
      });
    });
  });

  test('broadcastWorkspaceUpdated debounces and sequences', async () => {
    const captured: any[] = [];
    jest.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [{ webContents: { send: (_ch: string, payload?: unknown) => captured.push(payload) } }],
      },
    }), { virtual: true });

    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import('../../main/broadcast-helper');
        mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [] });
        mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [{ path: '/x' }] as any });
        mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [{ path: '/y' }] as any });

        // Debounced: no immediate send yet
        expect(captured.length).toBe(0);

        // Flush debounce window
        jest.advanceTimersByTime(110);

        expect(captured.length).toBe(1);
        const payload = captured[0] as any;
        expect(payload.workspaceId).toBe('w1');
        expect(payload.folderPath).toBe('/tmp/a');
        expect(Array.isArray(payload.selectedFiles)).toBe(true);
        // Should carry sequence and timestamp
        expect(typeof payload.sequence).toBe('number');
        expect(typeof payload.timestamp).toBe('number');

        // Next call should increment sequence
        mod.broadcastWorkspaceUpdated({ workspaceId: 'w1', folderPath: '/tmp/a', selectedFiles: [] });
        jest.advanceTimersByTime(110);
        expect(captured.length).toBe(2);
        const payload2 = captured[1] as any;
        expect(payload2.sequence).toBeGreaterThan(payload.sequence);
        resolve();
      });
    });
  });

  test('rate limiting drops excessive events within 1 second window', async () => {
    const sends: Array<{ ch: string; payload: unknown }> = [];
    jest.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [{ webContents: { send: (ch: string, payload?: unknown) => sends.push({ ch, payload }) } }],
      },
    }), { virtual: true });

    // Override config for test to a small rate
    jest.doMock('../../constants/broadcast', () => ({
      BROADCAST_CONFIG: { DEBOUNCE_MS: 5, MAX_EVENTS_PER_SECOND: 3 }
    }), { virtual: true });

    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import('../../main/broadcast-helper');
        for (let i = 0; i < 10; i++) {
          mod.broadcastToRenderers('test-rate', { i });
        }
        // Only first 3 should pass within the same second
        expect(sends.length).toBeLessThanOrEqual(3);

        // Advance time past window and ensure more can pass
        jest.advanceTimersByTime(1000);
        for (let i = 0; i < 2; i++) {
          mod.broadcastToRenderers('test-rate', { i: `after-${i}` });
        }
        expect(sends.length).toBeGreaterThanOrEqual(4);
        resolve();
      });
    });
  });
});
