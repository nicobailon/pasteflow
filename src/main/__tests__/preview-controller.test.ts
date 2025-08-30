import { PreviewController } from "../preview-controller";

type StatusPayload = { state?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; message?: string; progress?: number };

// Lightweight fake proxy to unit test PreviewController without Electron ipc
class FakeRendererPreviewProxy {
  startCalls: Array<{ id: string; options: unknown }> = [];
  cancelCalls: string[] = [];

  private statusHandlers = new Map<string, Set<(payload: StatusPayload) => void>>();
  private contentHandlers = new Map<string, Set<(payload: { id: string; content: string; fileCount?: number }) => void>>();

  start(id: string, options: unknown) {
    this.startCalls.push({ id, options });
  }

  cancel(id: string) {
    this.cancelCalls.push(id);
  }

  onStatus(id: string, handler: (payload: StatusPayload) => void): () => void {
    let set = this.statusHandlers.get(id);
    if (!set) {
      set = new Set();
      this.statusHandlers.set(id, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  onContent(id: string, handler: (payload: { id: string; content: string; fileCount?: number }) => void): () => void {
    let set = this.contentHandlers.get(id);
    if (!set) {
      set = new Set();
      this.contentHandlers.set(id, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  emitStatus(id: string, payload: StatusPayload) {
    const set = this.statusHandlers.get(id);
    if (!set) return;
    for (const h of set) h(payload);
  }

  async emitContent(id: string, payload: { content: string; fileCount?: number }) {
    const set = this.contentHandlers.get(id);
    if (!set) return;
    for (const h of set) await (h as any)({ id, ...payload });
  }
}

describe('PreviewController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('transitions PENDING -> RUNNING -> SUCCEEDED and returns content', async () => {
    const proxy = new FakeRendererPreviewProxy();
    const controller = new PreviewController(proxy as any, { timeoutMs: 5_000, jobTtlMs: 50 });
    const id = 'job-1';

    controller.startPreview(id, { prompt: 'Hello' });

    // Start was relayed to proxy
    expect(proxy.startCalls).toEqual([{ id, options: { prompt: 'Hello' } }]);

    // Initially PENDING
    const initial = controller.getStatus(id)!;
    expect(initial).toBeTruthy();
    expect(initial.state).toBe('PENDING');

    // RUNNING
    proxy.emitStatus(id, { state: 'RUNNING', progress: 0 });
    const running = controller.getStatus(id)!;
    expect(running.state).toBe('RUNNING');
    expect(typeof running.startedAt).toBe('number');

    // SUCCEEDED via content
    await proxy.emitContent(id, { content: 'abcdefgh', fileCount: 2 }); // ~2 tokens w/ CHARS_PER_TOKEN=4
    const doneStatus = controller.getStatus(id)!;
    expect(doneStatus.state).toBe('SUCCEEDED');
    expect(typeof doneStatus.finishedAt).toBe('number');
    // Content endpoint returns the payload + token count
    const result = controller.getResult(id)!;
    expect(result.id).toBe(id);
    expect(result.content).toBe('abcdefgh');
    expect(result.fileCount).toBe(2);
    expect(result.tokenCount).toBeGreaterThan(0);

    // Retention GC clears the job after TTL
    jest.advanceTimersByTime(60);
    expect(controller.getStatus(id)).toBeUndefined();
  });

  test('handles renderer-originated cancellation and failure', async () => {
    const proxy = new FakeRendererPreviewProxy();
    const controller = new PreviewController(proxy as any, { timeoutMs: 5_000, jobTtlMs: 50 });
    const idCancel = 'job-cancel';
    const idFail = 'job-fail';

    controller.startPreview(idCancel, {});
    controller.startPreview(idFail, {});

    // Renderer sends CANCELLED
    proxy.emitStatus(idCancel, { state: 'CANCELLED' });
    const cancelled = controller.getStatus(idCancel)!;
    expect(cancelled.state).toBe('CANCELLED');

    // Renderer sends FAILED
    proxy.emitStatus(idFail, { state: 'FAILED', message: 'boom' });
    const failed = controller.getStatus(idFail)!;
    expect(failed.state).toBe('FAILED');
    expect(failed.error?.message).toMatch(/boom/i);

    // Ensure timers can flush without open handles
    jest.runOnlyPendingTimers();
  });
});

