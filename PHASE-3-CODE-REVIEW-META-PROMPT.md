# Meta Prompt: Phase 3 Post-Implementation Code Review Fixes (Aggressive, No Legacy)

Role and execution constraints
- You are an LLM coding agent. Apply the following code review changes exactly as specified. Do not improvise beyond this spec.
- Avoid feature flags and legacy shims. Remove or simplify aggressively where noted.
- Use precise, surgical edits with verification after every logical chunk.
- Maintain the clickable code references convention to navigate the repo.

What you will deliver
- Targeted fixes in the worker-base and pool subclasses to address correctness, determinism, and typing issues uncovered during review.
- Light API additions on the bases for status/introspection to eliminate placeholders in subclasses.
- Minimal risk changes to message correlation, timeouts, and health checks to prevent cross-talk and hangs.
- Optional (low risk) polish where called out.

Validation gates (must pass after each numbered section)
- npm run lint:strict
- npm run test:ci
- npm run build && npm run build:main

If any gate fails, STOP and record the failing step and output in a “PHASE-3-POST-CR REVIEW: Failures” section in your PR description.

================================================================================
A) Issues found (authoritative)

1) Message correlation missing for discrete jobs
- In success path, pool resolves on any 'TOKEN_COUNT' event regardless of job id. This creates cross-talk under concurrency.
- Source: [DiscreteWorkerPoolBase.dispatch()](src/utils/worker-base/discrete-worker-pool-base.ts:233) calls [parseJobResult()](src/utils/worker-base/discrete-worker-pool-base.ts:78) without first verifying e.data.id matches the job id. Subclass [TokenWorkerPool.parseJobResult()](src/utils/token-worker-pool.ts:46) also doesn’t verify id.
- Batch path also lacks id checks: [DiscreteWorkerPoolBase.countBatch() message handler](src/utils/worker-base/discrete-worker-pool-base.ts:410) returns on any 'BATCH_RESULT'.

2) Batch operations lack timeout and cleanup guards
- countBatch() doesn’t enforce an operation timeout; listeners may leak and callers may hang.
- Source: [DiscreteWorkerPoolBase.countBatch()](src/utils/worker-base/discrete-worker-pool-base.ts:389).

3) Health check without correlation id
- Health requests don’t include a unique id; responses aren’t matched, risking cross-talk under concurrent checks.
- Source: [DiscreteWorkerPoolBase.healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434) posting a health check without id; handler doesn’t verify returned id (token worker sends ids).

4) Timer typing inconsistent with DOM
- Uses NodeJS.Timeout in renderer code. This can conflict in DOM typings. Should use ReturnType typeof setTimeout / setInterval.
- Sources:
  - [DiscreteWorkerPoolBase.healthMonitorInterval](src/utils/worker-base/discrete-worker-pool-base.ts:53)
  - [DiscreteWorkerPoolBase.dispatch timeoutId](src/utils/worker-base/discrete-worker-pool-base.ts:229)

5) worker-common.ts references jest without TS declaration and lacks import.meta URL fallback
- 'typeof jest' used without declaring 'jest' can fail type-checking. Also add import.meta.url branch before dev/production fallbacks.
- Source: [resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:10)

6) Subclass status placeholders should use base introspection
- [TokenWorkerPool.getStatus()](src/utils/token-worker-pool.ts:137) and [TreeBuilderWorkerPool.getStatus()](src/utils/tree-builder-worker-pool.ts:198) return hardcoded placeholders. Provide base-level status to avoid stale values.

7) Optional: Recovery workflow can proactively process queue after successful worker recoveries
- After recovery, calling processNext improves responsiveness without waiting for the next event loop tick.
- Source: [DiscreteWorkerPoolBase.recoverWorker()](src/utils/worker-base/discrete-worker-pool-base.ts:293)

================================================================================
B) Required changes (surgical)

Perform the steps in order. After each numbered block, run the Validation gates.

1) worker-common: TS declaration and URL resolution improvements

Edits in [worker-common.ts](src/utils/worker-base/worker-common.ts:1):

1.1 Add jest declaration at top (line 1):
- Insert:
  declare const jest: { fn?: unknown } | undefined;

1.2 Enhance resolveWorkerUrl() to attempt import.meta.url first:
- Replace body as follows, preserving dev/prod fallbacks and keeping return type string:

Pseudocode replacement:
- Try:
  - const metaUrl = eval('import.meta.url');
  - return new URL(workerRelativePath, metaUrl).toString();
- Catch:
  - If jest present → '/mock/worker/path'
  - If window && (localhost|127.0.0.1) → `/src/workers/${basename}`
  - Else → `./assets/${basename.replace('.ts','.js')}`

Ensure basename still computed once a single way. Keep current dev/electron prod logic as the last fallbacks.

2) DiscreteWorkerPoolBase: ID correlation, batch timeout, timer typing, health id matching, status API, post-recovery processing

Edits in [discrete-worker-pool-base.ts](src/utils/worker-base/discrete-worker-pool-base.ts:1):

2.1 Timer typing corrections:
- Change type of healthMonitorInterval from NodeJS.Timeout to ReturnType<typeof setInterval>:
  [line ~53]: private healthMonitorInterval?: ReturnType<typeof setInterval>;
- Change timeoutId type in dispatch from NodeJS.Timeout to ReturnType<typeof setTimeout>:
  [line ~229]: let timeoutId: ReturnType<typeof setTimeout> | null = null;

2.2 Success-path id correlation for discrete jobs:
- In message handler of [dispatch()](src/utils/worker-base/discrete-worker-pool-base.ts:233), add an early guard to drop unrelated messages:
  if (e.data?.id !== item.id) return;
- Then call parseJobResult(e, item.req). This ensures only messages tied to this job id are considered.

2.3 Batch path: id correlation + timeout and robust cleanup:
- In [countBatch() handler](src/utils/worker-base/discrete-worker-pool-base.ts:410), add:
  - Early guard: if (e.data?.id !== id) return; before parseBatchJobResult(...)
  - Enforce timeout with withTimeout wrapper:
    - Create an inner Promise<TRes[]> P that sets up listeners; then return await withTimeout(P, this.operationTimeoutMs, 'Batch operation').
  - On timeout (catch), remove listeners and resolve fallback for each request.
- Ensure listeners are removed on both success and error/timeout. Use removeWorkerListeners in finally.

2.4 Health check correlation id:
- In [healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434):
  - Generate const healthId = `health-${Date.now()}-${i}`;
  - Post: worker.postMessage({ type: this.handshake.healthCheckType, id: healthId });
  - In handler, match both type and id:
    if (e.data?.type === this.handshake.healthResponseType && e.data?.id === healthId) { ... }
- Keep withTimeout as is.

2.5 Base-level status snapshot API:
- Add a new method returning introspection data (public):
  public getStats() {
    return {
      queueLength: this.queue.length,
      activeJobs: this.activeJobs.size,
      workerCount: this.workers.length,
      healthyWorkers: this.workerHealthy.filter(Boolean).length,
      acceptingJobs: this.acceptingJobs,
      isTerminated: this.isTerminated
    };
  }
- This enables subclasses to report non-placeholder status.

2.6 Post-recovery processing (optional but recommended):
- After a successful recovery in [recoverWorker() finally or success path](src/utils/worker-base/discrete-worker-pool-base.ts:320-330), call this.processNext() to resume queued jobs quickly.
- Do not attempt to resolve active jobs here unless you also add plumbing to associate resolve() with activeJobs (out of scope). The error/timeout paths still provide fallback.

3) StreamingWorkerBase: Expose minimal status snapshot for subclasses

Edits in [streaming-worker-base.ts](src/utils/worker-base/streaming-worker-base.ts:1):

3.1 Add a simple public snapshot accessor:
- public getSnapshot() {
    return {
      state: this.state,
      queueLength: this.queue.length,
      hasActive: !!this.active
    };
  }

No other behavior change required.

4) TokenWorkerPool: Use base stats and rely on id-guarded dispatch

Edits in [token-worker-pool.ts](src/utils/token-worker-pool.ts:1):

4.1 parseJobResult no longer needs to attempt id verification; base dispatch now guards by id. Keep logic and compute value/fallback as-is.

4.2 getStatus should use base stats to avoid placeholders:
- Replace implementation:
  const s = this.getStats();
  return {
    isHealthy: s.healthyWorkers === s.workerCount && s.workerCount > 0,
    activeJobs: s.activeJobs,
    queueLength: s.queueLength,
    workerCount: s.workerCount
  };

5) TreeBuilderWorkerPool: Use streaming snapshot; remove unused jest declaration

Edits in [tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:1):

5.1 Remove the unused jest declaration block at the top (lines 6–8). It’s not used here.

5.2 getStatus should proxy base snapshot:
- Replace implementation:
  const snap = this.getSnapshot();
  return {
    state: snap.state,
    queueLength: snap.queueLength,
    hasActiveBuild: snap.hasActive
  };

5.3 Optional: Simplify initialize()
- Leave as-is if working. Alternative is adding a protected ensure-ready in base, but not strictly necessary now.

================================================================================
C) Diffs (pseudocode guidance)

File: [src/utils/worker-base/worker-common.ts](src/utils/worker-base/worker-common.ts:1)
- Insert at line 1:
  declare const jest: { fn?: unknown } | undefined;
- Replace resolveWorkerUrl body with the import.meta.url attempt first; fallback to jest/dev/prod as in “Required changes” 1.2.

File: [src/utils/worker-base/discrete-worker-pool-base.ts](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- Change types: healthMonitorInterval, timeoutId → ReturnType<typeof setInterval>/<typeof setTimeout>.
- In dispatch() message handler (around line 233):
  Insert at top: if (e.data?.id !== item.id) return;
- In countBatch():
  - Wrap the Promise with withTimeout(..., this.operationTimeoutMs, 'Batch operation').
  - In message handler:
    Insert at top: if (e.data?.id !== id) return;
  - Ensure removeWorkerListeners is called in both success and error and after timeout.
  - On timeout: resolve requests.map(req => this.fallbackValue(req)).
- In healthCheck():
  - Generate healthId and include it in postMessage request.
  - Verify both type and id before resolving; remove listeners either way.
- Add public getStats() returning queueLength/activeJobs/workerCount/healthyWorkers/acceptingJobs/isTerminated.
- In recoverWorker() after marking worker healthy, call this.processNext().

File: [src/utils/worker-base/streaming-worker-base.ts](src/utils/worker-base/streaming-worker-base.ts:1)
- Add public getSnapshot() per 3.1.

File: [src/utils/token-worker-pool.ts](src/utils/token-worker-pool.ts:1)
- Update getStatus() to use this.getStats() per 4.2.

File: [src/utils/tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:1)
- Remove jest declaration if unused (lines 6–8).
- Update getStatus() to use this.getSnapshot() per 5.2.

================================================================================
D) Tests to add/update

Create tests under src/utils/__tests__/worker-base/ as needed. If directory exists, append; else create.

1) Discrete message id correlation
- Simulate two in-flight jobs with different ids; ensure only the intended job resolves on each 'TOKEN_COUNT'.
- Target: [DiscreteWorkerPoolBase.dispatch() id guard](src/utils/worker-base/discrete-worker-pool-base.ts:233)

2) Batch timeout behavior
- Simulate no response to 'BATCH_COUNT'; verify withTimeout triggers fallback for all.
- Target: [DiscreteWorkerPoolBase.countBatch() timeout](src/utils/worker-base/discrete-worker-pool-base.ts:389)

3) Health-check id correlation
- Ensure multiple concurrent health checks resolve correctly when each includes a unique id.
- Target: [DiscreteWorkerPoolBase.healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)

4) Timer typing regression test (TS type-only)
- Ensure TS compiles under DOM libs; no NodeJS.Timeout leaks.

5) Streaming snapshot plumbing
- Ensure getSnapshot() accurately reflects state transitions: uninitialized → ready → active → idle.

If existing mocks aren’t sufficient, add a local lightweight MockWorker in test that:
- Queues a map of id → responses for COUNT_TOKENS/BATCH_COUNT and emits responses with the same id.
- Emits HEALTH_RESPONSE with incoming id.
- For batch timeout test, intentionally never emits to trigger withTimeout.

================================================================================
E) Acceptance criteria

- Discrete job success and batch handlers only resolve based on matching ids.
- Batch enforces operation timeout; listeners are removed in all paths; callers receive fallback array on timeout/error.
- Health-check responses are id-correlated; no cross-talk under concurrency.
- Timer types compile in DOM environment without NodeJS.Timeout.
- Subclass getStatus() methods return accurate live stats using base accessors.
- No change to worker message schemas; no feature flags; no legacy shims retained.
- Lint, tests, and builds pass.

================================================================================
F) Manual QA checklist (renderer)

- Launch dev: npm run dev
- Token counting concurrency smoke:
  - Trigger multiple counts simultaneously; verify no swapped counts across files; verify no console spam.
- Batch counting:
  - Trigger large selection causing batch; temporarily disable worker responses (if test harness available) to simulate timeout; verify fallback and no hang.
- Tree building:
  - Trigger streaming; cancel mid-flight; verify subsequent request proceeds; verify getStatus snapshot updates.
- Health monitor:
  - Temporarily stub worker to not respond to health checks; verify recover kicks in and queue resumes.

================================================================================
G) Commit choreography (suggested)

- fix(worker-common): declare jest; add import.meta URL fallback
- fix(discrete-base): id correlation, batch timeout, health id, timer types, stats, post-recovery process
- feat(streaming-base): add snapshot accessor
- refactor(token-pool): use base stats; rely on id-guarded dispatch
- refactor(tree-pool): use streaming snapshot; remove unused jest declaration
- test(worker-base): add id correlation, batch timeout, health id, snapshot tests

================================================================================
H) Stop conditions

- If tests or builds fail after any step, STOP immediately and document the failure and the current repo state. Do not proceed to subsequent steps.

================================================================================
Appendix: Quick pointers

- Success-path id guard location:
  - [DiscreteWorkerPoolBase.dispatch() handler](src/utils/worker-base/discrete-worker-pool-base.ts:233)

- Batch timeout location:
  - [DiscreteWorkerPoolBase.countBatch()](src/utils/worker-base/discrete-worker-pool-base.ts:389)

- Health id matching location:
  - [DiscreteWorkerPoolBase.healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)

- Subclass status plumbing:
  - [TokenWorkerPool.getStatus()](src/utils/token-worker-pool.ts:137)
  - [TreeBuilderWorkerPool.getStatus()](src/utils/tree-builder-worker-pool.ts:198)

End of meta prompt.