# Meta Prompt: Phase 3 Verification Follow-up — Final Corrections And Test Alignment (Aggressive, No Legacy)

Role
- You are an LLM coding agent finalizing Phase 3. Apply the corrections below precisely. Do not add feature flags or legacy shims. Remove dead code when replacing behavior.

Validation gates (run after each numbered section)
- npm run lint:strict
- npm run test:ci
- npm run build && npm run build:main

What was reviewed (evidence)
- Worker utilities and bases:
  - [worker-common.ts](src/utils/worker-base/worker-common.ts:1)
  - [DiscreteWorkerPoolBase](src/utils/worker-base/discrete-worker-pool-base.ts:44)
  - [StreamingWorkerBase](src/utils/worker-base/streaming-worker-base.ts:41)
- Pools:
  - [TokenWorkerPool](src/utils/token-worker-pool.ts:12)
  - [TreeBuilderWorkerPool](src/utils/tree-builder-worker-pool.ts:30)
- Tests and mocks (subset critical to verification):
  - [worker-pool-behavioral-test.ts](src/__tests__/worker-pool-behavioral-test.ts:1)
  - [worker-common.test.ts](src/utils/__tests__/worker-base/worker-common.test.ts:1)
  - [discrete-base.test.ts](src/utils/__tests__/worker-base/discrete-base.test.ts:1)
  - [streaming-base.test.ts](src/utils/__tests__/worker-base/streaming-base.test.ts:1)
  - [worker-pool-base-mocks.ts](src/__tests__/setup/worker-pool-base-mocks.ts:1)

Summary of gaps found vs. PHASE-3-CODE-REVIEW-META-PROMPT

1) worker-common
- Missing jest declaration; resolveWorkerUrl() lacks an import.meta.url-first branch and returns only relative dev/prod/jest paths.
  - Evidence: [resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:10)

2) DiscreteWorkerPoolBase
- Success-path message correlation is unsafe: no guard on id before parse; cross-talk risk.
  - Evidence: [dispatch() message handler](src/utils/worker-base/discrete-worker-pool-base.ts:233)
- Batch path has neither timeout nor id guard; listeners may leak and hangs can occur.
  - Evidence: [countBatch() handler](src/utils/worker-base/discrete-worker-pool-base.ts:409)
- Health-check lacks request id correlation and does not remove listeners on timeout paths.
  - Evidence: [healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)
- Timer types use NodeJS.Timeout; should use ReturnType<typeof setTimeout/setInterval> for DOM/Node compatibility.
  - Evidence: [healthMonitorInterval](src/utils/worker-base/discrete-worker-pool-base.ts:53), [timeoutId](src/utils/worker-base/discrete-worker-pool-base.ts:229)
- No base-level getStats() to report queue/active/health/worker counts; subclasses fake values.
  - Evidence: absence in [DiscreteWorkerPoolBase](src/utils/worker-base/discrete-worker-pool-base.ts:44)
- After recoverWorker, queue is not proactively resumed (missing processNext()).
  - Evidence: [recoverWorker()](src/utils/worker-base/discrete-worker-pool-base.ts:293)

3) StreamingWorkerBase
- No snapshot accessor for status; subclasses return placeholders.
  - Evidence: [StreamingWorkerBase](src/utils/worker-base/streaming-worker-base.ts:41)

4) TokenWorkerPool
- getStatus() returns placeholders; should use base stats to report real values.
  - Evidence: [getStatus()](src/utils/token-worker-pool.ts:137)
- getPerformanceStats() lacks queueLength, activeJobs, poolSize expected by tests.
  - Evidence: [worker-pool-behavioral-test](src/__tests__/worker-pool-behavioral-test.ts:141)
- Termination behavior differs from tests. Tests expect rejection when pool terminated; current base returns fallback.
  - Evidence: [worker-pool-behavioral-test](src/__tests__/worker-pool-behavioral-test.ts:169)
- No explicit >10MB guard at the pool boundary; tests expect rejection for oversize input.
  - Evidence: [worker-pool-behavioral-test](src/__tests__/worker-pool-behavioral-test.ts:60)

5) TreeBuilderWorkerPool
- Unused jest declaration remains; getStatus is placeholder and not using a snapshot from base.
  - Evidence: [jest declare](src/utils/tree-builder-worker-pool.ts:6), [getStatus()](src/utils/tree-builder-worker-pool.ts:198)

Action plan (perform in order)

Section 1 — worker-common hardening (resolveWorkerUrl, jest declaration)

1.1 Add the jest TS declaration at file top:
- Insert:
  - declare const jest: { fn?: unknown } | undefined;
File: [worker-common.ts](src/utils/worker-base/worker-common.ts:1)

1.2 Implement import.meta.url-first resolution then fallbacks:
- Replace resolveWorkerUrl() body with:
  - Try:
    - const metaUrl = eval('import.meta.url');
    - const url = new URL(workerRelativePath, metaUrl).toString();
    - return url;
  - Catch:
    - If jest: return '/mock/worker/path'
    - If window && (localhost|127.0.0.1): return `/src/workers/${basename}`
    - Else: return `./assets/${basename.replace('.ts','.js')}`
Preserve current basename derivation.
File: [resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:10)

Validation gates.

Section 2 — DiscreteWorkerPoolBase correctness (id guards, batch timeout, health ids, timers, stats, resume after recover)

2.1 Timer types
- Change types:
  - healthMonitorInterval?: ReturnType<typeof setInterval>
  - timeoutId in dispatch: let timeoutId: ReturnType<typeof setTimeout> | null = null
Files: [healthMonitorInterval](src/utils/worker-base/discrete-worker-pool-base.ts:53), [dispatch timeoutId](src/utils/worker-base/discrete-worker-pool-base.ts:229)

2.2 Id guard on success path
- At the top of dispatch() message handler, insert:
  - if (e.data?.id !== item.id) return;
File: [dispatch() message handler](src/utils/worker-base/discrete-worker-pool-base.ts:233)

2.3 Batch timeout + id correlation + deterministic cleanup
- In countBatch():
  - Select workerId, compute const id = batchMessage.id
  - Create inner Promise<TRes[]> P that:
    - adds handlers with first line: if (e.data?.id !== id) return;
    - on message: parseBatchJobResult; if results truthy → remove listeners → resolve(results)
    - on error: remove listeners → resolve(fallbacks)
  - Return await withTimeout(P, this.operationTimeoutMs, 'Batch operation') and ensure removeWorkerListeners is invoked on timeout path (catch/finally).
File: [countBatch()](src/utils/worker-base/discrete-worker-pool-base.ts:389)

2.4 Health-check correlation id + cleanup
- For each worker i:
  - const healthId = `health-${Date.now()}-${i}-${Math.random()}`
  - worker.postMessage({ type: this.handshake.healthCheckType, id: healthId })
  - handler: if (e.data?.type === this.handshake.healthResponseType && e.data?.id === healthId) { remove listeners; resolve(Boolean(e.data.healthy)) }
  - Wrap in withTimeout; on timeout, remove listeners in catch and treat as unhealthy.
File: [healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)

2.5 Base stats API (for subclasses)
- Add public getStats():
  - return { queueLength: this.queue.length, activeJobs: this.activeJobs.size, workerCount: this.workers.length, healthyWorkers: this.workerHealthy.filter(Boolean).length, acceptingJobs: this.acceptingJobs, isTerminated: this.isTerminated }
File: [DiscreteWorkerPoolBase](src/utils/worker-base/discrete-worker-pool-base.ts:44)

2.6 Proactive resume after recovery
- After successful handshake in recoverWorker(), call this.processNext()
File: [recoverWorker()](src/utils/worker-base/discrete-worker-pool-base.ts:323)

Validation gates.

Section 3 — StreamingWorkerBase status snapshot

3.1 Add public getSnapshot():
- return { state: this.state, queueLength: this.queue.length, hasActive: !!this.active }
File: [StreamingWorkerBase](src/utils/worker-base/streaming-worker-base.ts:41)

Validation gates.

Section 4 — TokenWorkerPool test-aligned behavior and reporting

4.1 getStatus() should use base stats:
- const s = this.getStats();
  return {
    isHealthy: s.healthyWorkers === s.workerCount && s.workerCount > 0,
    activeJobs: s.activeJobs,
    queueLength: s.queueLength,
    workerCount: s.workerCount
  }
File: [getStatus()](src/utils/token-worker-pool.ts:137)

4.2 getPerformanceStats() include fields expected by tests:
- Merge base stats into return:
  - const s = this.getStats();
  - return { ...existing, queueLength: s.queueLength, activeJobs: s.activeJobs, poolSize: s.workerCount }
File: [getPerformanceStats()](src/utils/token-worker-pool.ts:127)

4.3 Respect termination as rejection (align tests)
- If the pool is terminated, throw an Error('Worker pool has been terminated') in public API methods:
  - In countTokens()/countTokensBatch(), before delegating, consult this.getStats().isTerminated and throw if true.
Alternatively, change base countOne to reject when isTerminated. Prefer localized change here to avoid ripple.
Files: [countTokens()](src/utils/token-worker-pool.ts:99), [countTokensBatch()](src/utils/token-worker-pool.ts:113)

4.4 Large input guard at pool boundary (align tests)
- Before calling countOne in countTokens(), reject if text byte size exceeds 10MB:
  - const size = new TextEncoder().encode(text).length;
  - if (size > 10 * 1024 * 1024) throw new Error('Text too large for processing');
Note: This mirrors worker-side guard and test expectation.
File: [countTokens()](src/utils/token-worker-pool.ts:99)

Validation gates.

Section 5 — TreeBuilderWorkerPool cleanup and snapshot

5.1 Remove unused jest declaration
- Delete lines declaring jest.
File: [tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:6)

5.2 getStatus() should use streaming snapshot:
- const snap = this.getSnapshot();
  return { state: snap.state, queueLength: snap.queueLength, hasActiveBuild: snap.hasActive }
File: [getStatus()](src/utils/tree-builder-worker-pool.ts:198)

Validation gates.

Notes on tests and realignment

- worker-common.test remains valid: in Jest env resolveWorkerUrl returns '/mock/worker/path' (our path remains).
- Add or extend tests to cover:
  - Id correlation success path (two jobs in flight must not cross-resolve)
    - Target: [dispatch guard](src/utils/worker-base/discrete-worker-pool-base.ts:233)
  - Batch timeout path and cleanup
    - Target: [countBatch()](src/utils/worker-base/discrete-worker-pool-base.ts:389)
  - Health-check correlation ids
    - Target: [healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)
  - getStatus/getPerformanceStats reporting fields
    - Target: [TokenWorkerPool.getStatus()](src/utils/token-worker-pool.ts:137), [getPerformanceStats()](src/utils/token-worker-pool.ts:127)
  - Termination rejection and >10MB guard
    - Target: [TokenWorkerPool.countTokens()](src/utils/token-worker-pool.ts:99)

Acceptance criteria (must be true)
- Discrete job success resolves only when event id matches the job id; batch has timeout and id guard; handlers are cleaned in all paths.
- Health checks are id-correlated; listeners cleaned on success and timeout.
- Timer typing compiles under DOM libs without NodeJS.Timeout spillover.
- Streaming snapshot exists; TreeBuilder getStatus proxies it correctly; jest declaration removed.
- Token pool status/perf stats expose queueLength/activeJobs/poolSize; termination causes rejection; >10MB input rejected up front.
- All tests/builds pass.

Commit choreography (suggested)
- fix(worker-common): jest declare; import.meta url-first resolution
- fix(discrete-base): id guard, batch timeout/id, health id/cleanup, timer typing, getStats, resume after recover
- feat(streaming-base): add getSnapshot
- fix(token-pool): status/perf stats; termination rejection; 10MB guard
- refactor(tree-pool): remove jest declare; use snapshot in getStatus
- test(worker-base): add/extend id/batch/health tests

Stop conditions
- If any gate fails, STOP and document:
  - The section being applied
  - Failing command + excerpt
  - Suspected root cause and next action

Appendix: Direct edit pointers
- Guard location: [DiscreteWorkerPoolBase.dispatch()](src/utils/worker-base/discrete-worker-pool-base.ts:233)
- Batch handler location: [DiscreteWorkerPoolBase.countBatch()](src/utils/worker-base/discrete-worker-pool-base.ts:389)
- Health check location: [DiscreteWorkerPoolBase.healthCheck()](src/utils/worker-base/discrete-worker-pool-base.ts:434)
- Token pool status/perf: [getStatus()](src/utils/token-worker-pool.ts:137), [getPerformanceStats()](src/utils/token-worker-pool.ts:127)
- Tree pool status/jest: [tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:6), [getStatus()](src/utils/tree-builder-worker-pool.ts:198)