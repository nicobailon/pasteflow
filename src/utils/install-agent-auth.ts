// Installs a global fetch interceptor to attach Authorization for API calls
// and normalize chat endpoint paths in dev.

export function installAgentAuthInterceptor(): void {
  try {
    const w = window as any;
    if (w.__PF_FETCH_AUTH_INSTALLED) return;
    const originalFetch: typeof window.fetch = window.fetch.bind(window);

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const toUrl = (inp: RequestInfo | URL): URL => {
          if (typeof inp === 'string') return new URL(inp, window.location.origin);
          if (inp instanceof URL) return inp;
          // Request object
          return new URL((inp as Request).url, window.location.origin);
        };

        const url = toUrl(input);

        // Attach Authorization for API calls
        if (url.pathname.startsWith('/api/')) {
          const info = (window as any).__PF_API_INFO || {};
          const token = typeof info.authToken === 'string' ? info.authToken : '';
          if (token) {
            const hdrs = new Headers(init?.headers || (input as any)?.headers || undefined);
            hdrs.set('Authorization', `Bearer ${token}`);
            init = { ...(init || {}), headers: hdrs };
          }

          // Normalize /api/chat -> /api/v1/chat (dev convenience)
          if (url.pathname === '/api/chat') {
            url.pathname = '/api/v1/chat';
            input = url.toString();
          }
        }
      } catch {
        // ignore and fall back to original fetch
      }
      return originalFetch(input as any, init);
    };

    w.__PF_FETCH_AUTH_INSTALLED = true;
  } catch {
    // If anything goes wrong, do nothing
  }
}

