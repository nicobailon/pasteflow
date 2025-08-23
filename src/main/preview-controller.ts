import { RendererPreviewProxy, PreviewStartOptions } from './preview-proxy';
import { getMainTokenService } from '../services/token-service-main';

export type PreviewState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface PreviewJob {
  id: string;
  state: PreviewState;
  requestedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  options: PreviewStartOptions;
  result?: {
    content: string;
    tokenCount: number;
    fileCount: number;
  };
  error?: {
    code: 'PREVIEW_TIMEOUT' | 'INTERNAL_ERROR';
    message: string;
  };
}

interface ControllerOptions {
  timeoutMs?: number;
}

export class PreviewController {
  private jobs = new Map<string, PreviewJob>();
  private timeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly proxy: RendererPreviewProxy,
    private readonly opts: ControllerOptions = {}
  ) {}

  startPreview(id: string, options: PreviewStartOptions): void {
    const now = Date.now();
    const job: PreviewJob = {
      id,
      state: 'PENDING',
      requestedAt: now,
      options,
    };
    this.jobs.set(id, job);

    // Subscribe to events for this correlation id
    const offStatus = this.proxy.onStatus(id, (payload) => this.handleStatus(id, payload));
    const offContent = this.proxy.onContent(id, (payload) => this.handleContent(id, payload, () => {
      // Unsubscribe when content is received (terminal event)
      offStatus();
      offContent();
    }));

    // Start timeout timer
    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    const timer = setTimeout(() => {
      const j = this.jobs.get(id);
      if (!j || j.state === 'SUCCEEDED' || j.state === 'FAILED' || j.state === 'CANCELLED') return;
      j.state = 'FAILED';
      j.finishedAt = Date.now();
      j.durationMs = (j.startedAt ?? j.requestedAt) ? (j.finishedAt - (j.startedAt ?? j.requestedAt)) : undefined;
      j.error = { code: 'PREVIEW_TIMEOUT', message: 'Preview job timed out' };
      this.jobs.set(id, j);
      // Best-effort cancel request to renderer
      this.proxy.cancel(id);
      // Cleanup listeners
      offStatus();
      offContent();
      // Clear timer reference
      this.clearTimer(id);
    }, timeoutMs);
    this.timeouts.set(id, timer);

    // Kick off in renderer
    this.proxy.start(id, options);
  }

  getStatus(id: string): Omit<PreviewJob, 'result'> | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    // Return everything except result content in status
    const { result: _omit, ...rest } = job;
    return rest;
  }

  getResult(id: string): { id: string; content: string; tokenCount: number; fileCount: number } | undefined {
    const job = this.jobs.get(id);
    if (!job || job.state !== 'SUCCEEDED' || !job.result) return undefined;
    return { id: job.id, ...job.result };
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.state === 'SUCCEEDED' || job.state === 'FAILED' || job.state === 'CANCELLED') return;
    job.state = 'CANCELLED';
    job.finishedAt = Date.now();
    job.durationMs = (job.startedAt ?? job.requestedAt) ? (job.finishedAt - (job.startedAt ?? job.requestedAt)) : undefined;
    this.jobs.set(id, job);
    this.proxy.cancel(id);
    this.clearTimer(id);
  }

  // Internal handlers

  private handleStatus(id: string, payload: { state?: PreviewState; message?: string; progress?: number }): void {
    const j = this.jobs.get(id);
    if (!j) return;
    if (payload.state === 'RUNNING' && j.state === 'PENDING') {
      j.state = 'RUNNING';
      j.startedAt = j.startedAt ?? Date.now();
      this.jobs.set(id, j);
    } else if (payload.state === 'FAILED') {
      j.state = 'FAILED';
      j.finishedAt = Date.now();
      j.durationMs = (j.startedAt ?? j.requestedAt) ? (j.finishedAt - (j.startedAt ?? j.requestedAt)) : undefined;
      j.error = { code: 'INTERNAL_ERROR', message: payload.message || 'Preview failed' };
      this.jobs.set(id, j);
      this.clearTimer(id);
    }
    // Other status updates (progress, messages) are ignored here but could be tracked
  }

  private async handleContent(
    id: string,
    payload: { content: string; fileCount?: number },
    finalize: () => void
  ): Promise<void> {
    const j = this.jobs.get(id);
    if (!j) return;
    try {
      const tokenService = getMainTokenService();
      const { count } = await tokenService.countTokens(payload.content || '');
      j.state = 'SUCCEEDED';
      j.finishedAt = Date.now();
      j.durationMs = (j.startedAt ?? j.requestedAt) ? (j.finishedAt - (j.startedAt ?? j.requestedAt)) : undefined;
      j.result = {
        content: payload.content || '',
        tokenCount: count,
        fileCount: payload.fileCount ?? 0,
      };
      this.jobs.set(id, j);
    } catch (e) {
      j.state = 'FAILED';
      j.finishedAt = Date.now();
      j.durationMs = (j.startedAt ?? j.requestedAt) ? (j.finishedAt - (j.startedAt ?? j.requestedAt)) : undefined;
      j.error = { code: 'INTERNAL_ERROR', message: (e as Error)?.message || 'Token counting failed' };
      this.jobs.set(id, j);
    } finally {
      this.clearTimer(id);
      finalize();
    }
  }

  private clearTimer(id: string): void {
    const t = this.timeouts.get(id);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(id);
    }
  }
}