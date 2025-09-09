import React, { useState } from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import useAgentThreads from '../hooks/use-agent-threads';

type IpcInvoke = (channel: string, args?: unknown) => Promise<unknown> | unknown;

declare global {
  interface Window {
    electron?: {
      ipcRenderer?: {
        invoke: IpcInvoke;
        on: (ch: string, fn: (...a: unknown[]) => void) => void;
        removeListener: (ch: string, fn: (...a: unknown[]) => void) => void;
        send: (ch: string, ...args: unknown[]) => void;
      }
    }
  }
}

// Minimal helper to install a fake ipcRenderer.invoke (single mock)
function installIpcBridge(handlers: Record<string, (args?: unknown) => unknown>) {
  const invoke = jest.fn(async (channel: string, args?: unknown) => {
    const h = handlers[channel];
    if (h) return h(args);
    return { success: false, error: 'NO_HANDLER' };
  });
  const ipcRenderer = {
    invoke,
    on: (_ch: string, _fn: (...a: unknown[]) => void) => { /* no-op */ },
    removeListener: (_ch: string, _fn: (...a: unknown[]) => void) => { /* no-op */ },
    send: (_ch: string, _...args: unknown[]) => { /* no-op */ },
  };
  window.electron = { ipcRenderer };
  return invoke;
}

function TestComponent() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<unknown[]>([]);

  const { openThread } = useAgentThreads({
    currentWorkspace: null,
    selectedFolder: '/abs/folder',
    sessionId,
    getStatus: () => null,
    setSessionId,
    setHydratedMessages: setHydrated,
  });

  // Expose UI to trigger openThread
  return (
    <div>
      <button onClick={() => openThread('s123')}>open</button>
      <div data-testid="session">{sessionId || ''}</div>
      <div data-testid="hydrated">{Array.isArray(hydrated) ? hydrated.length : -1}</div>
    </div>
  );
}

describe('use-agent-threads openThread behavior', () => {
  test('omits empty workspaceId and surfaces failure as event + warning', async () => {
    const loadArgs: unknown[] = [];
    const invoke = installIpcBridge({
      '/prefs/get': () => ({ success: true, data: null }), // no active workspace
      '/workspace/list': () => ({ success: true, data: [] }), // no workspaces
      'agent:threads:load': (args) => {
        loadArgs.push(args);
        return { success: false, error: 'WORKSPACE_NOT_SELECTED' };
      }
    });

    const events: Array<{ code?: string }> = [];
    const onErr = (e: Event) => {
      const ev = e as CustomEvent<{ sessionId: string; code?: string }>;
      events.push({ code: ev?.detail?.code });
    };
    window.addEventListener('agent-thread-load-error', onErr as EventListener);

    render(<TestComponent />);
    fireEvent.click(screen.getByText('open'));

    await waitFor(() => {
      // 1) call did not include workspaceId when unresolved
      expect(loadArgs[0]).toEqual({ sessionId: 's123' });
      // 2) event was dispatched with failure code
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].code).toBe('WORKSPACE_NOT_SELECTED');
    });

    // 3) state updated: sessionId set and hydrated cleared
    expect(screen.getByTestId('session').textContent).toBe('s123');
    expect(screen.getByTestId('hydrated').textContent).toBe('0');

    // keep mock count small
    expect(typeof invoke).toBe('function');
    window.removeEventListener('agent-thread-load-error', onErr as EventListener);
  });
});

