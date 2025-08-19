# Meta Prompt: Phase 3 Implementation Plan — Shared Worker-Pool Base, Hook Convergence Prep (Aggressive, No Legacy)

Role and execution constraints
- You are an LLM coding agent implementing Phase 3 for PasteFlow.
- Execute each step exactly in order. Do not skip, merge, or re-sequence steps.
- Do not introduce feature flags. Do not maintain compatibility with legacy code. Delete legacy and redundant code paths aggressively when instructed.
- If any instruction is ambiguous, stop and surface a blocking note within a TODO subsection in the PR description; do not self-invent missing behavior.
- After each step, run the specified commands and only proceed if they pass.

Scope (Phase 3)
- Extract a shared worker-pool foundation to eliminate duplication between
  - [typescript.class TokenWorkerPool](src/utils/token-worker-pool.ts:30)
  - [typescript.class TreeBuilderWorkerPool](src/utils/tree-builder-worker-pool.ts:73)
- Refactor both pools to extend focused base classes.
- Consolidate worker-related mocks and add base-level tests.
- Keep or improve performance, error recovery, and determinism.

Non-goals
- Do not modify worker scripts' external message schemas in this phase.
- Do not refactor UI components, IPC handlers, or unrelated caching code.
- Do not add feature flags or keep backward compatibility shims.

Architectural overview (target)
- Two patterns require distinct bases, sharing low-level helpers:
  - Discrete pooled jobs (N workers, queue, dedupe, per-job results) → Token counting.
    - Base: [typescript.class DiscreteWorkerPoolBase<TReq, TRes>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - Single streaming job (one worker, chunked events, cancel/complete) → Tree building.
    - Base: [typescript.class StreamingWorkerBase<TStartReq, TChunk, TDone>](src/utils/worker-base/streaming-worker-base.ts:1)
  - Common helpers:
    - [typescript.module worker-common](src/utils/worker-base/worker-common.ts:1) → worker URL resolution (jest/dev/prod), listener add/remove, timeouts, handshake config types.

Message contracts (reference, do not change)
- Token counter worker: [src/workers/token-counter-worker.ts](src/workers/token-counter-worker.ts:1)
  - READY: 'WORKER_READY'
  - INIT: 'INIT' → INIT_COMPLETE: 'INIT_COMPLETE'
  - HEALTH: 'HEALTH_CHECK' → 'HEALTH_RESPONSE' { healthy: boolean }
  - JOB: 'COUNT_TOKENS' → 'TOKEN_COUNT' { result: number, fallback?: boolean } or 'ERROR'
  - BATCH: 'BATCH_COUNT' → 'BATCH_RESULT' number[] (or 'ERROR')
- Tree builder worker: [src/workers/tree-builder-worker.ts](src/workers/tree-builder-worker.ts:1)
  - READY: 'READY'
  - INIT: 'INIT' → READY again
  - BUILD: 'BUILD_TREE' → streaming 'TREE_CHUNK' then 'TREE_COMPLETE'; failures via 'TREE_ERROR'
  - CANCEL: 'CANCEL' → 'CANCELLED' (ack)

New code layout (to be created)
- src/utils/worker-base/
  - worker-common.ts
  - discrete-worker-pool-base.ts
  - streaming-worker-base.ts
- Refactors:
  - [src/utils/token-worker-pool.ts](src/utils/token-worker-pool.ts:30) extends DiscreteWorkerPoolBase
  - [src/utils/tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:73) extends StreamingWorkerBase
- Tests/mocks:
  - src/__tests__/setup/worker-pool-base-mocks.ts (single entrypoint)
  - Unit tests for base classes under src/utils/__tests__/worker-base/*.test.ts

Design — worker-common.ts
Provide low-level utilities (no side effects, no heavy logging in production):
- [typescript.interface HandshakeConfig](src/utils/worker-base/worker-common.ts:1)
  - readySignalType: string
  - initRequestType: string
  - initResponseType: string
  - errorType: string
  - healthCheckType?: string
  - healthResponseType?: string
- [typescript.function resolveWorkerUrl(workerRelativePath: string): URL | string](src/utils/worker-base/worker-common.ts:1)
  - If jest detected (typeof jest !== 'undefined'), return '/mock/worker/path'
  - Else try new URL(workerRelativePath, import.meta.url) guarded via eval to avoid Jest parsing
  - Fallbacks for dev ('/src/workers/..') and Electron production ('./assets/...worker.js') if needed
- [typescript.function addWorkerListeners(worker: Worker, handlers: { message: fn; error?: fn; messageerror?: fn }): void](src/utils/worker-base/worker-common.ts:1)
- [typescript.function removeWorkerListeners(worker: Worker, handlers: { message: fn; error?: fn; messageerror?: fn }): void](src/utils/worker-base/worker-common.ts:1)
- [typescript.function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>](src/utils/worker-base/worker-common.ts:1)

Design — DiscreteWorkerPoolBase<TReq, TRes>
Responsibilities:
- Manage a fixed pool of Workers; handshake on boot and after recovery.
- Queue with priorities; bounded; drop lowest-priority items past capacity.
- Pending request de-duplication by hash.
- Active job map with deterministic cleanup; timeouts yield fallback marker.
- Health monitoring at interval; per-worker recovery with lock; no race explosions.
- Optional batch request path (if implemented by subclass); fallback to parallel per-item.
Public constructor params:
- poolSize: number
- workerRelativePath: string
- handshake: HandshakeConfig
- operationTimeoutMs: number
- healthCheckTimeoutMs: number
- healthMonitorIntervalSec: number
- queueMaxSize: number
Abstract methods to implement in subclass:
- [typescript.method buildJobMessage(request: TReq, id: string): { type: string; id: string; payload: unknown }](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method parseJobResult(event: MessageEvent, request: TReq): { value: TRes; usedFallback: boolean } | null](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method buildBatchJobMessage(requests: TReq[], id: string): { type: string; id: string; payload: unknown } | null](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method parseBatchJobResult(event: MessageEvent, requests: TReq[]): TRes[] | null](src/utils/worker-base/discrete-worker-pool-base.ts:1)
Overridable hooks:
- [typescript.method hashRequest(req: TReq): string](src/utils/worker-base/discrete-worker-pool-base.ts:1) (defaults to JSON length and content hash)
- [typescript.method onWorkerRecovered(workerId: number): void](src/utils/worker-base/discrete-worker-pool-base.ts:1)
Provided public API:
- [typescript.method countOne(request: TReq, options?: { signal?: AbortSignal; priority?: number }): Promise<TRes>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method countBatch(requests: TReq[], options?: { signal?: AbortSignal; priority?: number }): Promise<TRes[]>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method healthCheck(): Promise<Array<{ workerId: number; healthy: boolean; responseTime: number }>>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method performHealthMonitoring(): Promise<void>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method terminate(): void](src/utils/worker-base/discrete-worker-pool-base.ts:1)

Design — StreamingWorkerBase<TStartReq, TChunk, TDone>
Responsibilities:
- Manage one worker.
- One active build at a time; queued requests; dedupe by hash.
- Handshake on start; robust cancel with timeout and CANCELLED ack; forced cleanup if timeout.
- Route messages to callbacks; cleanly reinitialize worker after error if needed.
Public constructor params:
- workerRelativePath: string
- handshake: HandshakeConfig
- initTimeoutMs: number
- cancelTimeoutMs: number
Abstract methods to implement in subclass:
- [typescript.method buildInitMessage(): { type: string }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method buildStartMessage(req: TStartReq, id: string): { type: string; id: string; ... }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method buildCancelMessage(id: string): { type: string; id: string }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseChunk(event: MessageEvent, id: string): TChunk | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseComplete(event: MessageEvent, id: string): TDone | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseError(event: MessageEvent, id: string): Error | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method isCancelledAck(event: MessageEvent, id: string): boolean](src/utils/worker-base/streaming-worker-base.ts:1)
Overridable hooks:
- [typescript.method hashRequest(req: TStartReq): string](src/utils/worker-base/streaming-worker-base.ts:1)
Provided public API:
- [typescript.method startStreaming(req: TStartReq, callbacks: { onChunk: (c: TChunk) => void; onComplete: (d: TDone) => void; onError: (e: Error) => void; }): { cancel: () => Promise<void> }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method terminate(): Promise<void>](src/utils/worker-base/streaming-worker-base.ts:1)

Aggressive cleanup mandates (no legacy retention)
- Remove duplicated queue, listener, and recovery code from both pools; after refactor, subclasses must only implement message mapping and small policy hooks.
- Remove inline dev-only logging aside from a small debug utility gated by NODE_ENV !== 'production'. Do not leave console.error/console.warn in hot paths unless required by tests. Convert to a debug function in worker-common and use sparingly.
- Remove inline jest/import.meta.url hacks from pools; relocate to worker-common resolveWorkerUrl().
- Remove any unused or redundant metrics methods. If a metric is used by tests/UI, re-implement as proxies to base-provided stats methods. Otherwise, delete.

Detailed refactor plan (strict steps)

Step 0 — Branch and verify baseline
- git checkout -b feat/phase-3-worker-base
- npm run lint:strict
- npm run test:ci
- npm run build && npm run build:main
- If any failures: STOP. Create a “Phase 3 preflight” issue with logs.

Step 1 — Create worker-base scaffolding
- Add folder: src/utils/worker-base/
- Create files with empty exports:
  - [worker-common.ts](src/utils/worker-base/worker-common.ts:1)
  - [discrete-worker-pool-base.ts](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - [streaming-worker-base.ts](src/utils/worker-base/streaming-worker-base.ts:1)
- Export skeleton types/functions/classes with minimal code (throw new Error('Unimplemented') in methods).
- Commands:
  - npm run lint:strict
  - npm run test:ci
- Expect tests to fail until wiring is done; proceed.

Step 2 — Implement worker-common
- Implement [HandshakeConfig](src/utils/worker-base/worker-common.ts:1).
- Implement [resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:1) with:
  - Jest path shortcut '/mock/worker/path'
  - eval('import.meta.url') guarded URL fallback
  - Dev path '/src/workers/..' and Electron prod './assets/*.js' fallback if URL construction fails
- Implement [addWorkerListeners()](src/utils/worker-base/worker-common.ts:1) and [removeWorkerListeners()](src/utils/worker-base/worker-common.ts:1).
- Implement [withTimeout()](src/utils/worker-base/worker-common.ts:1).
- Commands: lint + minimal unit test for resolveWorkerUrl path selection in JSDOM (mock global scopes)

Step 3 — Implement DiscreteWorkerPoolBase
- Internal state:
  - workers: Worker[]
  - workerStatus: boolean[]; workerReady: boolean[]
  - queue: Array<{ id: string; req: TReq; resolve: fn; reject: fn; priority: number }>
  - activeJobs: Map<string, { workerId: number; start: number; req: TReq }>
  - pendingByHash: Map<string, Promise<TRes>>
  - recoveryLocks: Map<number, boolean>; recoveryQueue: Map<number, Promise<void>>
  - flags: isTerminated, acceptingJobs, preparingForShutdown, isRecycling
- Handshake algorithm:
  - On init: create N workers via resolveWorkerUrl(); listen for readySignalType; send initRequestType; wait for initResponseType (withTimeout).
- Queue policy:
  - push() sorts by priority ascending; enforce max size by removing last (highest priority value).
  - On drop, reject or resolve with fallback? POLICY: resolve with fallback result via subclass fallback handler (token: estimate) or reject for streaming; here choose resolve with subclass-provided fallback value (require subclass to define a fallback method or provide a boolean to resolve vs reject). For token counting, resolve with estimate; supply a protected [typescript.method fallbackValue(req: TReq): TRes](src/utils/worker-base/discrete-worker-pool-base.ts:1).
- Health monitoring:
  - At interval, send healthCheckType; wait for healthResponseType; if unhealthy, recoverWorker(workerId).
  - Recovery:
    - acquire lock → cleanup listeners → terminate → create new worker → wait ready/init → mark healthy
- Job dispatch:
  - find available worker; if none, enqueue; else send job message (buildJobMessage).
  - Setup timeout; on timeout → resolve with fallback; cleanup listeners; schedule next.
- Batch path:
  - If subclass provides buildBatchJobMessage and parseBatchJobResult, send one message; else parallel countOne.
- Public APIs as listed above.
- Commands:
  - Add unit tests under src/utils/__tests__/worker-base/discrete-base.test.ts
    - queue drop policy
    - request hash dedupe
    - timeout fallback
    - recovery lock prevents duplicate recoveries

Step 4 — Implement StreamingWorkerBase
- Internal state:
  - worker: Worker | null
  - queue: Array<{ id: string; req: TStartReq; callbacks: {...}; hash: string }>
  - active: { id: string; req: TStartReq; callbacks: {...}; cancelled: boolean } | null
  - state: 'uninitialized' | 'initializing' | 'ready' | 'error'
- Handshake: wait readySignalType; then consider init complete (or send initRequestType if defined).
- Start execution: add listeners; send buildStartMessage.
- Chunk routing: parseChunk → callbacks.onChunk
- Complete routing: parseComplete → callbacks.onComplete → cleanupActive → process next
- Error routing: parseError → callbacks.onError → cleanup → set state 'uninitialized'
- Cancel:
  - send buildCancelMessage; wait for isCancelledAck within cancelTimeoutMs; else force cleanup
- Dedupe:
  - hashRequest(req) default: stable path set + params stringification; subclasses override
- Public APIs as listed above.
- Commands:
  - Add unit tests under src/utils/__tests__/worker-base/streaming-base.test.ts
    - cancel timeout fallback
    - dedupe
    - error routing resets state

Step 5 — Refactor TokenWorkerPool to extend DiscreteWorkerPoolBase
- Replace the majority of [src/utils/token-worker-pool.ts](src/utils/token-worker-pool.ts:30) internal orchestration with subclass implementation:
  - workerRelativePath: '../workers/token-counter-worker.ts'
  - handshake:
    - readySignalType: 'WORKER_READY'
    - initRequestType: 'INIT'
    - initResponseType: 'INIT_COMPLETE'
    - errorType: 'ERROR'
    - healthCheckType: 'HEALTH_CHECK'
    - healthResponseType: 'HEALTH_RESPONSE'
  - Provide:
    - [typescript.method buildJobMessage({ text }: { text: string }, id)](src/utils/token-worker-pool.ts:30) → { type: 'COUNT_TOKENS', id, payload: { text } }
    - [typescript.method parseJobResult(evt, req)](src/utils/token-worker-pool.ts:30) → if evt.data.id===id and type==='TOKEN_COUNT' return { value: result or estimate when fallback=true; usedFallback: boolean }
    - [typescript.method buildBatchJobMessage(texts: { text: string }[], id)](src/utils/token-worker-pool.ts:30) → { type: 'BATCH_COUNT', id, payload: { texts: texts.map(t => t.text) } }
    - [typescript.method parseBatchJobResult(evt, reqs)](src/utils/token-worker-pool.ts:30) → if type==='BATCH_RESULT' return evt.data.results
    - [typescript.method fallbackValue(req)](src/utils/token-worker-pool.ts:30) → estimateTokenCount(req.text)
    - [typescript.method hashRequest(req)](src/utils/token-worker-pool.ts:30) → a fast charcode hash of req.text + length (reuse current)
- Delete duplicated code paths in TokenWorkerPool:
  - Event listener bookkeeping, health monitor loop, recovery locks, draining queue, etc. (now inherited)
  - Keep only thin metrics proxy methods if used by tests; else remove.
- Update WorkerPoolBackend in renderer to use the new TokenWorkerPool as-is (no further changes expected in [src/services/token-service-renderer.ts](src/services/token-service-renderer.ts:1)).
- Commands:
  - npm run lint:strict
  - npm run test:ci -- src/__tests__/token-worker-* src/__tests__/worker-pool-behavioral-test.ts
  - npm run build

Step 6 — Refactor TreeBuilderWorkerPool to extend StreamingWorkerBase
- Map worker messages per [src/workers/tree-builder-worker.ts](src/workers/tree-builder-worker.ts:1):
  - readySignalType: 'READY'
  - initRequestType: 'INIT'
  - initResponseType: 'READY' (post-INIT)
  - errorType: 'TREE_ERROR'
  - No health messages in this worker; StreamingWorkerBase must not assume healthCheck
- Provide subclass methods:
  - [typescript.method buildInitMessage()](src/utils/tree-builder-worker-pool.ts:73) → { type: 'INIT' }
  - [typescript.method buildStartMessage(req, id)](src/utils/tree-builder-worker-pool.ts:73) → { type: 'BUILD_TREE', id, ...files, chunkSize, selectedFolder, expandedNodes }
  - [typescript.method buildCancelMessage(id)](src/utils/tree-builder-worker-pool.ts:73) → { type: 'CANCEL', id }
  - [typescript.method parseChunk(evt, id)](src/utils/tree-builder-worker-pool.ts:73) → if type==='TREE_CHUNK' and ids match return payload
  - [typescript.method parseComplete(evt, id)](src/utils/tree-builder-worker-pool.ts:73) → if type==='TREE_COMPLETE' return payload
  - [typescript.method parseError(evt)](src/utils/tree-builder-worker-pool.ts:73) → if type==='TREE_ERROR' return Error(payload)
  - [typescript.method isCancelledAck(evt, id)](src/utils/tree-builder-worker-pool.ts:73) → type==='CANCELLED' and ids match
  - [typescript.method hashRequest(startReq)](src/utils/tree-builder-worker-pool.ts:73) → reuse current calculateRequestHash: sorted file paths + selectedFolder + expanded true-keys
- Delete duplicated logic in the original class: init retries, queue processing, message handlers, cancel management (re-implement as thin overrides if strictly needed).
- Commands:
  - npm run lint:strict
  - npm run test:ci -- src/__tests__/tree-builder-worker-pool-error-handling.test.ts
  - npm run build

Step 7 — Mocks consolidation
- Create [src/__tests__/setup/worker-pool-base-mocks.ts](src/__tests__/setup/worker-pool-base-mocks.ts:1)
  - Export MockTokenWorkerPool compatible with the new DiscreteWorkerPoolBase surface; use simple setTimeout + CHARS_PER_TOKEN estimation behavior.
  - Export MockStreamingWorker harness that:
    - Emits READY on construction
    - On INIT echoes READY
    - On BUILD_TREE posts a few TREE_CHUNK then TREE_COMPLETE; supports CANCEL to post CANCELLED
- Update [src/__tests__/setup/mock-token-worker-pool.ts](src/__tests__/setup/mock-token-worker-pool.ts:1) to re-export from the new entrypoint or delete if not referenced (preferred: delete if tests updated).
- Update tests to import from the new mocks entrypoint.
- Commands:
  - npm run test:ci

Step 8 — Base-level unit tests (must-have)
- Discrete base:
  - Dedup returns same Promise for identical req hash across concurrent calls
  - Drop policy removes highest priority value item when queue full
  - Timeout path yields fallback result and cleans up listeners
  - Recovery lock: concurrent recoverWorker calls collapse into one
- Streaming base:
  - CANCEL timeout forces cleanup and continues with next queued request
  - Dedup of identical build requests keeps only the last queued (replace policy) or first; choose replace policy to match tree pool behavior
  - Error event resets to 'uninitialized' state and allows subsequent re-init
- Commands:
  - npm run lint:strict
  - npm run test:ci

Step 9 — Aggressive deletions and simplifications
- Remove any dead metrics/logging utilities and unused exports from both pools.
- Remove ad-hoc health monitoring functions duplicated in TokenWorkerPool after base refactor.
- Remove any environment guards in pools that are now covered in worker-common resolveWorkerUrl.
- Run a dead-code search:
  - ripgrep-like patterns (conceptual): TokenWorkerPool.*(recovery|health|waitFor) and TreeBuilderWorkerPool.*(initialize|retry|messageHandler|errorHandler)
- Commands:
  - npm run lint:strict
  - npm run test:ci
  - npm run build && npm run build:main

Step 10 — Integration sanity
- Renderer: [src/services/token-service-renderer.ts](src/services/token-service-renderer.ts:1) should continue working through its [typescript.class WorkerPoolBackend](src/services/token-service-renderer.ts:9). Confirm:
  - countTokens and countTokensBatch path still return numbers; if error patterns changed, adapt WorkerPoolBackend accordingly (small changes allowed).
- Main: unaffected; tree builder is renderer-only.
- Commands:
  - npm run build
  - Run a small smoke test: start dev renderer and open workspace (manual if available).

Step 11 — Documentation and comments
- In each base, add class-level JSDoc covering:
  - Purpose and scope
  - Handshake lifecycle
  - Timeout and fallback policy
  - Recovery strategy and lock rationale
  - Template methods contract and invariants
- In subclasses, add concise comments only for overrides.

Step 12 — Final verification and PR
- Ensure:
  - npm run lint:strict passes
  - npm run test:ci passes
  - npm run build && npm run build:main passes
- Submit PR titled: “Phase 3: Shared Worker Bases, Aggressive De-duplication (No Legacy)”
- Include in PR description:
  - Summary of architecture
  - List of removed legacy code paths
  - Coverage summary of new tests
  - Risk assessment and rollback (revert PR)

Policy clarifications and explicit decisions
- Timeout fallback for token counting returns estimated tokens via CHARS_PER_TOKEN (consistent with existing behavior).
- Tree builder cancellation uses forced cleanup after CANCEL timeout; do not block the queue; proceed to next request immediately after forced cleanup.
- Health monitoring for streaming worker is intentionally omitted unless the worker implements health messages.
- Discrete base recovery is per-worker; a full recycle may be implemented later if memory thresholds dictate.

Test blueprint (file-level)
- src/utils/__tests__/worker-base/discrete-base.test.ts
  - “returns same promise for dedup hash” test
  - “drops lowest priority when queue full” test
  - “timeout yields fallback and cleans listeners” test
  - “recovery lock prevents duplicate recoveries” test
- src/utils/__tests__/worker-base/streaming-base.test.ts
  - “cancel timeout forces cleanup” test
  - “dedupe replaces queued identical request” test
  - “error resets to uninitialized and allows re-init” test
- src/__tests__/setup/worker-pool-base-mocks.ts
  - MockTokenWorkerPool
  - MockStreamingWorker

Acceptance criteria (must all be true)
- TokenWorkerPool and TreeBuilderWorkerPool are lean subclasses with minimal logic; orchestration is in the bases.
- No legacy code paths or dev-only hacks remain in pools (jest/import.meta.url logic moved to worker-common).
- New base-level unit tests exist and pass; consolidated mocks are used.
- Lint/build/tests all succeed.
- No feature flags; no backward-compat shims maintained.

Commands quick reference
- Lint: npm run lint:strict
- Tests: npm run test:ci
- Build renderer: npm run build
- Build main: npm run build:main

Risk register and mitigations
- Risk: Subtle behavior drift in queue handling after refactor.
  - Mitigation: Unit tests for queue and timeout policies; snapshot pre/post behavior via targeted tests.
- Risk: Worker URL resolution differs across environments.
  - Mitigation: Centralize in resolveWorkerUrl; add unit tests for jest/dev/prod resolution branches.
- Risk: Streaming cancel semantics regress.
  - Mitigation: Explicit cancel timeout tests; require CANCELLED ack handling.
- Risk: Health monitor churn causes recovery storms.
  - Mitigation: Recovery lock map; exponential backoff can be added later if needed.

Deletion checklist (execute after refactor compiles)
- TokenWorkerPool: remove custom waitForWorkersReady, waitForWorkerInit, performHealthMonitoring duplicates (they move to base).
- TreeBuilderWorkerPool: remove bespoke createWorkerWithStandardUrl/createWorkerWithFallbacks, queue processing loops, and explicit listener cleanup functions (replaced by base).
- Old mocks re-exports removed in favor of src/__tests__/setup/worker-pool-base-mocks.ts.

Explicit templates to implement in subclasses
- TokenWorkerPool:
  - type TReq = { text: string }; type TRes = number
  - buildJobMessage({ text }, id)
  - parseJobResult(event, req)
  - buildBatchJobMessage([{ text }], id)
  - parseBatchJobResult(event, reqs)
  - fallbackValue({ text }) → estimateTokenCount(text)
  - hashRequest({ text }) → stable short hash
- TreeBuilderWorkerPool:
  - type TStartReq = { files: FileData[]; selectedFolder: string | null; expandedNodes: Record<string, boolean>; chunkSize?: number }
  - type TChunk = { nodes: TreeNode[]; progress: number }
  - type TDone = { nodes: TreeNode[]; progress: number }
  - buildInitMessage()
  - buildStartMessage(req, id)
  - buildCancelMessage(id)
  - parseChunk(event, id)
  - parseComplete(event, id)
  - parseError(event, id)
  - isCancelledAck(event, id)
  - hashRequest(req) (sorted file paths + selectedFolder + expanded true-keys)

Coding standards and patterns
- Use discriminated unions for worker event data shapes where helpful.
- Use narrow unknown → specific type guards in parse methods; never assume structure.
- Always cleanup listeners in finally; no dangling references. Use removeWorkerListeners helper.
- Avoid console in production; provide debug() helper in worker-common if logs are needed in tests.

Commit strategy (suggested)
- chore(base): add worker-base scaffolding (unimplemented)
- feat(base): implement worker-common helpers
- feat(base): implement DiscreteWorkerPoolBase
- feat(base): implement StreamingWorkerBase
- refactor(token-pool): extend discrete base; delete duplicated orchestration
- refactor(tree-pool): extend streaming base; delete duplicated orchestration
- test(base): add unit tests for discrete/streaming bases
- test(mocks): add worker-pool-base-mocks and wire tests
- chore(clean): remove obsolete helpers and legacy code

Stop conditions
- If any step introduces failing tests that cannot be resolved within the step scope, STOP. Do not proceed. Open a “Phase 3 blocker” issue with logs and suspected cause.
- If worker URL resolution cannot satisfy all environments, STOP. Revisit resolveWorkerUrl design and add test coverage before proceeding.

End of meta prompt
- Do not write production code beyond what is described in each step.
- Validate after each step with the commands listed.
- Prefer smaller, verifiable commits over large ones.
---
## Extended, Concrete Implementation Blueprint (Aggressive, No Legacy)

This section augments the plan with highly concrete, prescriptive instructions, skeletons, invariants, tests, and validation flows so a less capable coding agent can execute Phase 3 without guesswork. Follow exactly. Do not deviate.

Section Index
1) Worker message mapping tables (authoritative)
2) worker-common.ts: full API blueprint
3) DiscreteWorkerPoolBase<TReq, TRes>: full API blueprint, invariants, pseudo-impl
4) StreamingWorkerBase<TStartReq, TChunk, TDone>: full API blueprint, invariants, pseudo-impl
5) Subclass implementations: TokenWorkerPool and TreeBuilderWorkerPool
6) Unit test blueprints (exact files, assertions)
7) Mocks consolidation details
8) Aggressive code removal checklists (tokens/tree)
9) Validation gates, manual QA scripts, CI checklist
10) Timeline and commit choreography
11) Search/replace patterns for de-duplication and verification
12) Risk hardening and failure drill steps

Important: Throughout this appendix, all language constructs and files are referenced in the clickable format required by the project guidelines.

---

1) Worker message mapping tables (authoritative)

Token Counter Worker ([src/workers/token-counter-worker.ts](src/workers/token-counter-worker.ts:1))
- Signals:
  - READY: 'WORKER_READY'
  - INIT: 'INIT' → INIT_COMPLETE: 'INIT_COMPLETE'
  - HEALTH: 'HEALTH_CHECK' → 'HEALTH_RESPONSE' { healthy: boolean }
- Jobs (single):
  - Request: 'COUNT_TOKENS' { id: string, payload: { text: string } }
  - Response: 'TOKEN_COUNT' { id, result: number, fallback?: boolean } OR 'ERROR' { id, error }
- Jobs (batch):
  - Request: 'BATCH_COUNT' { id, payload: { texts: string[] } }
  - Response: 'BATCH_RESULT' { id, results: number[] } OR 'ERROR'

Tree Builder Worker ([src/workers/tree-builder-worker.ts](src/workers/tree-builder-worker.ts:1))
- Signals:
  - READY: 'READY'
  - INIT: 'INIT' → READY: 'READY'
- Streaming:
  - Start: 'BUILD_TREE' { id, allFiles, chunkSize, selectedFolder, expandedNodes }
  - Chunk: 'TREE_CHUNK' { id, payload: { nodes, progress } }
  - Done: 'TREE_COMPLETE' { id, payload: { nodes, progress: 100 } }
  - Error: 'TREE_ERROR' { id, code, error }
  - Cancel: 'CANCEL' { id } → Ack: 'CANCELLED' { id }

---

2) worker-common.ts: full API blueprint

Create [typescript.interface HandshakeConfig](src/utils/worker-base/worker-common.ts:1)
- readySignalType: string
- initRequestType: string
- initResponseType: string
- errorType: string
- healthCheckType?: string
- healthResponseType?: string

Create [typescript.function resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:1)
- Signature: resolveWorkerUrl(workerRelativePath: string): URL | string
- Behavior (in order):
  1) If jest present (typeof jest !== 'undefined'): return '/mock/worker/path'
  2) Try:
     - const metaUrl = eval('import.meta.url')
     - return new URL(workerRelativePath, metaUrl)
  3) If window exists and (hostname is 'localhost' or '127.0.0.1'): return `/src/workers/${basename(workerRelativePath)}`
  4) Else assume Electron prod: return `./assets/${basename(workerRelativePath).replace('.ts', '.js')}`

Create [typescript.function addWorkerListeners()](src/utils/worker-base/worker-common.ts:1)
- Signature: addWorkerListeners(worker: Worker, handlers: { message: (e: MessageEvent) => void; error?: (e: ErrorEvent) => void; messageerror?: (e: MessageEvent) => void }): void
- Use worker.addEventListener for each defined handler.

Create [typescript.function removeWorkerListeners()](src/utils/worker-base/worker-common.ts:1)
- Inverse of addWorkerListeners; no-throw on errors.

Create [typescript.function withTimeout<T>()](src/utils/worker-base/worker-common.ts:1)
- Signature: withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>
- Reject with new Error(`${label} timeout after ${ms}ms`) on timeout; clears timers deterministically.

Debug logging helper (optional):
- [typescript.function debugLog()](src/utils/worker-base/worker-common.ts:1) that logs only if NODE_ENV !== 'production'. Keep usage minimal.

---

3) DiscreteWorkerPoolBase<TReq, TRes>: API blueprint, invariants, pseudo-impl

Create [typescript.class DiscreteWorkerPoolBase<TReq, TRes>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
Constructor params:
- poolSize: number
- workerRelativePath: string
- handshake: HandshakeConfig
- operationTimeoutMs: number
- healthCheckTimeoutMs: number
- healthMonitorIntervalSec: number
- queueMaxSize: number

Protected abstract hooks (must be implemented by subclass):
- [typescript.method buildJobMessage()](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - (req: TReq, id: string) => { type: string; id: string; payload: unknown }
- [typescript.method parseJobResult()](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - (event: MessageEvent, req: TReq) => { value: TRes; usedFallback: boolean } | null
- [typescript.method buildBatchJobMessage()](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - (reqs: TReq[], id: string) => { type: string; id: string; payload: unknown } | null
- [typescript.method parseBatchJobResult()](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - (event: MessageEvent, reqs: TReq[]) => TRes[] | null
- [typescript.method fallbackValue()](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - (req: TReq) => TRes

Overridables:
- [typescript.method hashRequest(req: TReq)](src/utils/worker-base/discrete-worker-pool-base.ts:1)
  - default: JSON.stringify(req).length + 32-bit hash of first N code points

Public API:
- [typescript.method countOne(req: TReq, options?: { signal?: AbortSignal; priority?: number }): Promise<TRes>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method countBatch(reqs: TReq[], options?: { signal?: AbortSignal; priority?: number }): Promise<TRes[]>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method healthCheck(): Promise<Array<{ workerId: number; healthy: boolean; responseTime: number }>>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method performHealthMonitoring(): Promise<void>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- [typescript.method terminate(): void](src/utils/worker-base/discrete-worker-pool-base.ts:1)

Internal fields (recommended):
- workers: Worker[]
- workerReady: boolean[]
- workerHealthy: boolean[]
- queue: Array<{ id: string; req: TReq; resolve: (v: TRes) => void; reject: (e: Error) => void; priority: number }>
- activeJobs: Map<string, { workerId: number; start: number; req: TReq }>
- pendingByHash: Map<string, Promise<TRes>>
- flags: isTerminated, acceptingJobs, preparingForShutdown, isRecycling
- locks: recoveryLocks: Map<number, boolean>; recoveryQueue: Map<number, Promise<void>>

Algorithm pseudo-impl (high-level):

- init():
  - Resolve URL via [resolveWorkerUrl()](src/utils/worker-base/worker-common.ts:1), new Worker(url, { type: 'module' }) poolSize times.
  - For each worker:
    - wait readySignalType (withTimeout)
    - postMessage({ type: initRequestType, id: `init-${i}` })
    - wait initResponseType (withTimeout)
    - set workerReady[i] = true; workerHealthy[i] = true

- countOne(req, options):
  - If not acceptingJobs or terminated → return fallbackValue(req)
  - const h = hashRequest(req); if pendingByHash has h → return that promise
  - else create promise P; pendingByHash.set(h, P)
  - find available worker:
    - available = workerHealthy[i] && !isBusy(i)
    - if none → enqueue (with priority default 0/CRITICAL if not provided), enforce queueMaxSize:
      - If exceeded: drop item with highest numeric priority; resolve that item with fallbackValue(item.req)
  - On assignment:
    - const id = `job-${Date.now()}-${rnd}`
    - activeJobs.set(id, { workerId, start, req })
    - add listeners (message/error) bound to id
    - worker.postMessage(buildJobMessage(req, id))
    - withTimeout for operationTimeoutMs; on timeout: resolve fallbackValue(req), cleanup; process next
    - On message:
      - parseJobResult(event, req) → result? resolve; cleanup; next
      - If errorType: resolve fallbackValue(req); cleanup; next

- countBatch(reqs):
  - If subclass supports batch (buildBatchJobMessage != null):
    - Same pattern as countOne: assign a worker; send batch request; parseBatchJobResult
  - Else: parallel Promise.all(countOne(req)) with lower priority (background) if requested

- healthCheck():
  - For each worker, send healthCheckType; await healthResponseType with withTimeout; compute responseTime; mark healthy.

- performHealthMonitoring():
  - setInterval(healthMonitorIntervalSec) → healthCheck(); for unhealthy: recoverWorker(workerId)

- recoverWorker(workerId):
  - Acquire recoveryLocks guard
  - remove listeners; worker.terminate()
  - create new worker; wait ready/init; set healthy; release lock

- terminate():
  - Stop accepting jobs; abort active jobs (resolve fallback)
  - Clear queue via resolving fallback
  - Remove all listeners; terminate all workers
  - Clear maps and arrays

Invariants:
- No dangling listeners after resolve/reject/timeout.
- pendingByHash cleaned on promise settle.
- Queue is always priority-sorted ascending numeric.
- Recovery lock prevents concurrent recoveries for same worker.

---

4) StreamingWorkerBase<TStartReq, TChunk, TDone>: API blueprint, invariants, pseudo-impl

Create [typescript.class StreamingWorkerBase<TStartReq, TChunk, TDone>](src/utils/worker-base/streaming-worker-base.ts:1)
Constructor params:
- workerRelativePath: string
- handshake: HandshakeConfig
- initTimeoutMs: number
- cancelTimeoutMs: number

Abstract hooks:
- [typescript.method buildInitMessage(): { type: string }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method buildStartMessage(req: TStartReq, id: string): { type: string; id: string; ... }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method buildCancelMessage(id: string): { type: string; id: string }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseChunk(event: MessageEvent, id: string): TChunk | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseComplete(event: MessageEvent, id: string): TDone | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method parseError(event: MessageEvent, id: string): Error | null](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method isCancelledAck(event: MessageEvent, id: string): boolean](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method hashRequest(req: TStartReq): string](src/utils/worker-base/streaming-worker-base.ts:1)

Public API:
- [typescript.method startStreaming(req: TStartReq, callbacks: { onChunk: (c: TChunk) => void; onComplete: (d: TDone) => void; onError: (e: Error) => void; }): { cancel: () => Promise<void> }](src/utils/worker-base/streaming-worker-base.ts:1)
- [typescript.method terminate(): Promise<void>](src/utils/worker-base/streaming-worker-base.ts:1)

State:
- worker: Worker | null
- state: 'uninitialized' | 'initializing' | 'ready' | 'error'
- queue: Array<{ id: string; req: TStartReq; callbacks: {...}; hash: string }>
- active: { id: string; req: TStartReq; callbacks: {...}; cancelled: boolean } | null

Algorithm pseudo-impl:
- ensureReady():
  - if state === 'ready' return
  - construct worker via resolveWorkerUrl; wait for readySignalType (withTimeout(initTimeoutMs))
  - send buildInitMessage if needed; accept initResponseType or re-READY as success
  - state = 'ready'
- startStreaming():
  - compute hash; if same hash in queue, replace older entry (replace policy)
  - if !active: processNext()
  - return { cancel: () => cancelActiveIfMatch(id) }
- processNext():
  - if state !== 'ready': await ensureReady() (if fails → callbacks.onError for all queued; state='error'; clear queue)
  - dequeue item; set active
  - add listeners: on message route parseChunk/parseComplete/parseError; on 'error' event: callbacks.onError; cleanupActive(); state='uninitialized'
  - postMessage(buildStartMessage(req, id))
- cancel(id):
  - if active && active.id===id:
    - postMessage(buildCancelMessage(id))
    - wait cancelTimeoutMs for isCancelledAck; else force cleanupActive (remove listeners), state remains whichever; proceed processNext()

Invariants:
- At most one active at a time
- Replace policy ensures latest identical-start request wins
- Cancel always cleans up listeners and frees slot

---

5) Subclass implementations

TokenWorkerPool ([src/utils/token-worker-pool.ts](src/utils/token-worker-pool.ts:30))
- After refactor, must extend [typescript.class DiscreteWorkerPoolBase<{ text: string }, number>](src/utils/worker-base/discrete-worker-pool-base.ts:1)
- Provide:
  - workerRelativePath: '../workers/token-counter-worker.ts'
  - handshake: { readySignalType: 'WORKER_READY', initRequestType: 'INIT', initResponseType: 'INIT_COMPLETE', errorType: 'ERROR', healthCheckType: 'HEALTH_CHECK', healthResponseType: 'HEALTH_RESPONSE' }
  - buildJobMessage({ text }, id): { type: 'COUNT_TOKENS', id, payload: { text } }
  - parseJobResult(evt, req): 
    - if evt.data.id !== id return null
    - if evt.data.type === 'TOKEN_COUNT':
      - return { value: evt.data.fallback ? fallbackValue(req) : evt.data.result, usedFallback: !!evt.data.fallback }
    - if evt.data.type === 'ERROR': return { value: fallbackValue(req), usedFallback: true }
    - else return null
  - buildBatchJobMessage(reqs, id): { type: 'BATCH_COUNT', id, payload: { texts: reqs.map(r => r.text) } }
  - parseBatchJobResult(evt, reqs): if evt.data.type==='BATCH_RESULT' and ids match → evt.data.results
  - fallbackValue({ text }): estimateTokenCount(text)
  - hashRequest({ text }): fast code-point hash + length (reuse current pattern)
- Drop legacy code: queue arrays, listener maps, recovery locks, health monitor loops—migrate to base.

TreeBuilderWorkerPool ([src/utils/tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:73))
- Extend [typescript.class StreamingWorkerBase<StartReq, Chunk, Done>](src/utils/worker-base/streaming-worker-base.ts:1)
- Types:
  - StartReq: { files: FileData[]; selectedFolder: string | null; expandedNodes: Record<string, boolean>; chunkSize?: number }
  - Chunk: { nodes: TreeNode[]; progress: number }
  - Done: { nodes: TreeNode[]; progress: number }
- Provide:
  - workerRelativePath: '../workers/tree-builder-worker.ts'
  - handshake: { readySignalType: 'READY', initRequestType: 'INIT', initResponseType: 'READY', errorType: 'TREE_ERROR' } (no health)
  - buildInitMessage(): { type: 'INIT' }
  - buildStartMessage(req, id): { type: 'BUILD_TREE', id, allFiles: req.files, chunkSize: req.chunkSize ?? UI.TREE.CHUNK_SIZE, selectedFolder: req.selectedFolder, expandedNodes: req.expandedNodes }
  - buildCancelMessage(id): { type: 'CANCEL', id }
  - parseChunk(evt, id): if evt.data.type==='TREE_CHUNK' && id match → evt.data.payload
  - parseComplete(evt, id): if evt.data.type==='TREE_COMPLETE' && id match → evt.data.payload
  - parseError(evt, id): if evt.data.type==='TREE_ERROR' && id match → new Error(evt.data.error || evt.data.code || 'TREE_ERROR')
  - isCancelledAck(evt, id): evt.data.type==='CANCELLED' && id match
  - hashRequest(req): same deterministic hash: sorted files by path + selectedFolder + sorted expanded true-keys
- Drop legacy: bespoke worker retry loops, cancellation timeouts, message handlers, etc.

---

6) Unit test blueprints (exact files, assertions)

Create directory: src/utils/__tests__/worker-base/

A) Discrete base tests ([src/utils/__tests__/worker-base/discrete-base.test.ts](src/utils/__tests__/worker-base/discrete-base.test.ts:1))
- “dedup returns same promise for identical hash”:
  - Arrange two countOne(reqA) calls with identical { text }; assert promise identity and single worker dispatch.
- “queue drops lowest priority when full”:
  - Setup queueMaxSize=2; submit three jobs with priorities [0, 10, 10]; assert that one of the prio 10 items resolves via fallback and not dispatched.
- “timeout resolves fallback and cleans listeners”:
  - Simulate worker not responding; ensure withTimeout triggers; assert fallback returned; assert no lingering listeners for that id.
- “recovery lock prevents duplicate recoveries”:
  - Force health check to mark worker unhealthy; call internal recover twice concurrently; assert only one new Worker created (spy on constructor).

B) Streaming base tests ([src/utils/__tests__/worker-base/streaming-base.test.ts](src/utils/__tests__/worker-base/streaming-base.test.ts:1))
- “cancel timeout forces cleanup”:
  - StartStreaming; do not emit CANCELLED; ensure cancel returns after cancelTimeoutMs and next queued request proceeds.
- “dedupe replaces queued identical request”:
  - Queue two identical StartReq; ensure hash replacement policy results in only one execution (latest overwrites).
- “error resets to uninitialized and allows re-init”:
  - Emit TREE_ERROR; assert state='uninitialized'; follow-up request triggers re-handshake and succeeds.

Ensure to mock Worker behavior via consolidated mocks (see §7).

---

7) Mocks consolidation details

Create [src/__tests__/setup/worker-pool-base-mocks.ts](src/__tests__/setup/worker-pool-base-mocks.ts:1)
- Export MockTokenWorkerPool-like adapter if needed by specific tests; but base tests should mock Worker directly:
  - Provide a MockWorker class that:
    - constructor(url, opts) stores handlers; immediately post READY-type signal depending on test (configurable)
    - postMessage for:
      - COUNT_TOKENS: schedule setTimeout(() => message({ type: 'TOKEN_COUNT', id, result: Math.ceil(text.length/CHARS_PER_TOKEN), fallback: false }))
      - BATCH_COUNT: schedule batch result
      - HEALTH_CHECK: schedule HEALTH_RESPONSE
      - BUILD_TREE: emit several TREE_CHUNK then TREE_COMPLETE
      - CANCEL: optionally emit CANCELLED or remain silent (to test timeout)
- Utility helpers to swap global Worker with MockWorker during tests; restore afterward.

Update existing tests importing [src/__tests__/setup/mock-token-worker-pool.ts](src/__tests__/setup/mock-token-worker-pool.ts:1):
- Replace usage with new mocks where meaningful; if some tests still use the old file, re-export from new entrypoint to avoid duplication:
  - New file content: `export * from './worker-pool-base-mocks'`

---

8) Aggressive code removal checklists (no legacy retained)

TokenWorkerPool ([src/utils/token-worker-pool.ts](src/utils/token-worker-pool.ts:30))
- Remove:
  - initializeWorkers, waitForWorkersReady, waitForWorkerInit, performHealthMonitoring (replaced by base)
  - workerListeners maps, activeOperations, workerRecoveryLocks, cleanupTimeouts if not needed by subclass
  - enqueueJob/enforceQueueSizeLimit/processNextInQueue if base provides replacements
  - sendWorkerMessage/createWorkerHandlers if base handles all dispatch
- Keep (if still used by UI/tests):
  - getPerformanceStats/getStatus/validateInternalState; implement by delegating to base or provide trimmed minimal versions; otherwise delete if dead.

TreeBuilderWorkerPool ([src/utils/tree-builder-worker-pool.ts](src/utils/tree-builder-worker-pool.ts:73))
- Remove:
  - initializeWithRetry/initialize/createWorkerWithStandardUrl/createWorkerWithFallbacks
  - processQueue, createMessageHandler, createErrorHandler, cleanupActiveBuild, cancelActiveBuild
  - findElectronWorkerPath, createDevelopmentWorker (moved to resolveWorkerUrl)
- Keep only thin wrappers as required by tests (isReady, getInitializationError, waitForInitialization, getStatus, retryInitialization) by deferring to StreamingWorkerBase state.

Search and delete (confirm with grep)
- Token pool legacy:
  - Patterns: “waitForWorkersReady|waitForWorkerInit|performHealthMonitoring|cleanupWorkerListeners|activeOperations|workerRecoveryLocks”
- Tree builder legacy:
  - Patterns: “initializeWithRetry|createWorkerWithStandardUrl|createWorkerWithFallbacks|processQueue|createMessageHandler|createErrorHandler|cleanupActiveBuild|cancelActiveBuild|findElectronWorkerPath”

---

9) Validation gates, manual QA scripts, CI checklist

Validation gates (must pass before moving on at each prior step):
- npm run lint:strict
- npm run test:ci
- npm run build && npm run build:main

Manual QA (renderer dev)
- npm run dev
- Open a repo with thousands of files; observe:
  - Tree building progresses with CHUNK events and finishes with COMPLETE
  - Cancellation of a tree build (trigger appropriate UI if available) does not stall next builds
  - Selecting multiple large text files: token counts appear; batch counting improves speed; no console spam
- Check memory:
  - Trigger large batches; monitor console for absence of “listener leaked” warnings.

CI checklist
- Unit tests cover base behaviors
- No snapshots dependent on legacy logs or timing assumptions remain

---

10) Timeline and commit choreography (granular)

1) chore(base): add worker-base scaffolding (unimplemented stubs)
2) feat(base): implement worker-common helpers + unit tests
3) feat(base): implement DiscreteWorkerPoolBase + discrete-base tests
4) feat(base): implement StreamingWorkerBase + streaming-base tests
5) refactor(token): TokenWorkerPool extends DiscreteWorkerPoolBase; delete legacy; adapt renderer backend if signature impact
6) refactor(tree): TreeBuilderWorkerPool extends StreamingWorkerBase; delete legacy; ensure compile
7) test(mocks): add worker-pool-base-mocks; rewire any dependent tests
8) chore(clean): sweep dead code; remove dev-only hacks; enforce debug logs policy
9) docs: add JSDoc to bases; brief subclass comments
10) finalize: run all validations; submit PR

---

11) Search/replace patterns for de-duplication and verification

Search to identify legacy orchestration
- Token:
  - from ["']COUNT_TOKENS["']|activeJobs|workerListeners|performHealthMonitoring|cleanupWorkerListeners|recycleWorkers|waitForWorkersReady|waitForWorkerInit
- Tree:
  - from ["']BUILD_TREE["']|createWorkerWithStandardUrl|createWorkerWithFallbacks|processQueue|cleanupActiveBuild|cancelActiveBuild

Search to verify new bases used
- from ["']../worker-base/discrete-worker-pool-base["']
- from ["']../worker-base/streaming-worker-base["']
- from ["']../worker-base/worker-common["']

---

12) Risk hardening and failure drill steps

Failure drills to test:
- Token worker silently stops emitting messages mid-job:
  - Expect: withTimeout kicks in, fallback result returned, job cleanup executed, queue continues
- Tree builder CANCEL never acknowledged:
  - Expect: cancel timeout fires, forced cleanup, next queued build proceeds
- Health monitor marks token worker unhealthy:
  - Expect: single recovery in-flight per worker; no stampede

If any drill fails:
- STOP; add targeted unit test to reproduce; fix base; re-run validations.

---

Appendix: Concrete subclass pseudocode fragments (for less capable agent)

TokenWorkerPool minimal subclass sketch:
- class TokenWorkerPool extends DiscreteWorkerPoolBase<{ text: string }, number> {
  constructor() {
    super(
      /* poolSize */ Math.min(navigator.hardwareConcurrency || 4, 8),
      /* workerRelativePath */ '../workers/token-counter-worker.ts',
      /* handshake */ { readySignalType: 'WORKER_READY', initRequestType: 'INIT', initResponseType: 'INIT_COMPLETE', errorType: 'ERROR', healthCheckType: 'HEALTH_CHECK', healthResponseType: 'HEALTH_RESPONSE' },
      /* operationTimeoutMs */ 30_000,
      /* healthCheckTimeoutMs */ 1_000,
      /* healthMonitorIntervalSec */ 30,
      /* queueMaxSize */ 1000
    );
  }
  protected buildJobMessage(req, id) { return { type: 'COUNT_TOKENS', id, payload: { text: req.text } }; }
  protected parseJobResult(evt, req) {
    if (!evt?.data || evt.data.id === undefined) return null;
    if (evt.data.type === 'TOKEN_COUNT') {
      const usedFallback = !!evt.data.fallback;
      const value = usedFallback ? this.fallbackValue(req) : Number(evt.data.result ?? 0);
      return { value, usedFallback };
    }
    if (evt.data.type === 'ERROR') return { value: this.fallbackValue(req), usedFallback: true };
    return null;
  }
  protected buildBatchJobMessage(reqs, id) { return { type: 'BATCH_COUNT', id, payload: { texts: reqs.map(r => r.text) } }; }
  protected parseBatchJobResult(evt, _reqs) { return (evt?.data?.type === 'BATCH_RESULT') ? (evt.data.results ?? null) : null; }
  protected fallbackValue(req) { return Math.ceil((req.text?.length ?? 0) / 4); }
  protected hashRequest(req) { /* reuse fast hash from old pool */ return `${req.text?.length ?? 0}-${this.simpleHash(req.text ?? '')}`; }
  private simpleHash(s: string) { let h = 0; for (let i = 0; i < Math.min(s.length, 1024); i++) { h = (h << 5) - h + (s.codePointAt(i) ?? 0); h |= 0; } return h; }
}

TreeBuilderWorkerPool minimal subclass sketch:
- class TreeBuilderWorkerPool extends StreamingWorkerBase<StartReq, Chunk, Done> {
  constructor() {
    super(
      '../workers/tree-builder-worker.ts',
      { readySignalType: 'READY', initRequestType: 'INIT', initResponseType: 'READY', errorType: 'TREE_ERROR' },
      /* initTimeoutMs */ 5_000,
      /* cancelTimeoutMs */ 2_000
    );
  }
  protected buildInitMessage() { return { type: 'INIT' }; }
  protected buildStartMessage(req, id) { return { type: 'BUILD_TREE', id, allFiles: req.files, chunkSize: req.chunkSize ?? 1000, selectedFolder: req.selectedFolder, expandedNodes: req.expandedNodes }; }
  protected buildCancelMessage(id) { return { type: 'CANCEL', id }; }
  protected parseChunk(evt, id) { return (evt?.data?.id === id && evt.data.type === 'TREE_CHUNK') ? evt.data.payload : null; }
  protected parseComplete(evt, id) { return (evt?.data?.id === id && evt.data.type === 'TREE_COMPLETE') ? evt.data.payload : null; }
  protected parseError(evt, id) { return (evt?.data?.id === id && evt.data.type === 'TREE_ERROR') ? new Error(evt.data.error || evt.data.code || 'TREE_ERROR') : null; }
  protected isCancelledAck(evt, id) { return (evt?.data?.id === id && evt.data.type === 'CANCELLED'); }
  protected hashRequest(req) {
    const files = [...req.files].map(f => f.path).sort().join('|');
    const expanded = Object.entries(req.expandedNodes || {}).filter(([, v]) => !!v).map(([k]) => k).sort().join('|');
    return `${files}:${req.selectedFolder || ''}:${expanded}:${req.chunkSize ?? 1000}`;
  }
}

End of extended blueprint.