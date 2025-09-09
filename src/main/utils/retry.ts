/*
 * Generic retry helper for rate-limit and transient provider errors.
 * Supports Retry-After header parsing, exponential backoff, and jitter.
 */

type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  isRetriable?: (err: unknown) => boolean;
  getRetryAfterMs?: (err: unknown) => number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function extractStatus(err: unknown): number | null {
  try {
    const status = Number(
      (err as { status?: number } | null | undefined)?.status ??
        (err as { statusCode?: number } | null | undefined)?.statusCode ??
        (err as { response?: { status?: number } } | null | undefined)?.response?.status ??
        (err as { cause?: { status?: number } } | null | undefined)?.cause?.status
    );
    if (Number.isFinite(status)) return status;
    const msg = String((err as { message?: string } | null | undefined)?.message || '').toLowerCase();
    if (/(?:^|\b)(429|too many requests)(?:\b|$)/.test(msg)) return 429;
    return null;
  } catch {
    return null;
  }
}

function defaultIsRetriable(err: unknown): boolean {
  const status = extractStatus(err);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function get(obj: unknown, key: string): unknown {
  return isObject(obj) ? (obj as Record<string, unknown>)[key] : undefined;
}

function headerGet(headersObj: unknown, name: string): string | undefined {
  if (!isObject(headersObj)) return undefined;
  try {
    const maybeGet = (headersObj as { get?: (n: string) => string | null | undefined }).get;
    if (typeof maybeGet === 'function') {
      const v = maybeGet.call(headersObj, name) || maybeGet.call(headersObj, name.toLowerCase()) || maybeGet.call(headersObj, name.toUpperCase());
      return typeof v === 'string' ? v : undefined;
    }
    const rec = headersObj as Record<string, unknown>;
    const raw = (rec[name] ?? rec[name.toLowerCase?.() ?? name] ?? rec[name.toUpperCase?.() ?? name]);
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number') return String(raw);
    return undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfterMs(value: string): number | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  // seconds value
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0) {
    return Math.floor(asNum * 1000);
  }
  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function defaultGetRetryAfterMs(err: unknown): number | null {
  try {
    const candidates: unknown[] = [];
    const response = get(err, 'response');
    const cause = get(err, 'cause');
    if (isObject(response)) {
      candidates.push(get(response, 'headers'));
    }
    candidates.push(get(err, 'headers'));
    const causeResp = get(cause, 'response');
    if (isObject(causeResp)) {
      candidates.push(get(causeResp, 'headers'));
    }
    candidates.push(get(cause, 'headers'));
    for (const h of candidates) {
      const v = headerGet(h, 'retry-after');
      if (typeof v === 'string' && v) {
        const ms = parseRetryAfterMs(v);
        if (ms != null) return ms;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function withRateLimitRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts?.attempts ?? 3));
  const baseMs = Math.max(0, Math.floor(opts?.baseMs ?? 800));
  const maxMs = Math.max(baseMs, Math.floor(opts?.maxMs ?? 8000));
  const isRetriable = opts?.isRetriable ?? defaultIsRetriable;
  const getRetryAfterMs = opts?.getRetryAfterMs ?? defaultGetRetryAfterMs;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      let shouldRetry = false;
      try {
        shouldRetry = !!isRetriable(err);
      } catch {
        shouldRetry = false;
      }
      if (!shouldRetry) {
        // Fallback to default classification if custom checker declined/errored
        try { shouldRetry = defaultIsRetriable(err); } catch { /* noop */ }
      }
      if (!shouldRetry || attempt === attempts) {
        throw err;
      }
      let delay = getRetryAfterMs(err);
      if (delay == null) {
        const backoff = baseMs * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 0.25 * backoff); // up to 25% jitter
        delay = backoff + jitter;
      }
      delay = Math.min(maxMs, Math.max(0, Math.floor(delay)));
      try {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('[AI] retrying after provider backoff', { attempt, delayMs: delay });
        }
      } catch { /* noop */ }
      await sleep(delay);
      continue;
    }
  }
  // Should be unreachable
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  throw lastError;
}

export type { RetryOptions };
