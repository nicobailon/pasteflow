import { withRateLimitRetries } from "../../main/utils/retry";

describe("withRateLimitRetries", () => {
  it("retries on 429 and eventually succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) {
        const err: any = new Error("Too Many Requests");
        err.status = 429;
        throw err;
      }
      return "ok";
    };

    const result = await withRateLimitRetries(fn, { attempts: 3, baseMs: 1, maxMs: 2 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("uses provided getRetryAfterMs when available", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 2) {
        const err: any = new Error("Service Unavailable");
        err.status = 503;
        throw err;
      }
      return 42;
    };
    const result = await withRateLimitRetries(fn, {
      attempts: 2,
      baseMs: 1000, // would be long without override
      maxMs: 1000,
      getRetryAfterMs: () => 2, // keep test fast
    });
    expect(result).toBe(42);
    expect(calls).toBe(2);
  });

  it("does not retry non-retriable errors", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err: any = new Error("Bad Request");
      err.status = 400;
      throw err;
    };
    await expect(withRateLimitRetries(fn, { attempts: 3, baseMs: 1, maxMs: 2 })).rejects.toThrow("Bad Request");
    expect(calls).toBe(1);
  });
});

