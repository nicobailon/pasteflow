# Architecture Analysis Report

## Executive Summary

PasteFlow’s codebase is strong in performance monitoring and worker-based concurrency. Foundational cleanup and consolidation are complete, and token counting/caching are now unified behind a clear façade and a single cache foundation.

Accomplished
- Single source of truth for constants via the constants barrel at [src/constants/index.ts](src/constants/index.ts:1), with alias-based imports across renderer/tests.
- Dead code and unused dependencies removed; electron-builder unpack list trimmed.
- React initialization loop eliminated through effect dependency fixes and stabilized options.
- Token counting unified behind a façade available in both environments:
  - Renderer backend via worker pool + estimate fallback: [WorkerPoolBackend](src/services/token-service-renderer.ts:9), [createRendererTokenService()](src/services/token-service-renderer.ts:83).
  - Main backend via tiktoken + estimate fallback: [TiktokenBackend](src/services/token-service-main.ts:11), [createMainTokenService()](src/services/token-service-main.ts:89).
  - Facade with preferred/available/estimate selection and batch support: [TokenService](src/services/token-service.ts:24), [TokenService.countTokens()](src/services/token-service.ts:48), [TokenService.countTokensBatch()](src/services/token-service.ts:105).
- Caching converged on a unified LRU(+TTL) layer with adapters:
  - Unified cache and specializations: [UnifiedCache<K,V>](src/services/cache-service.ts:20), [FileContentCache](src/services/cache-service.ts:106), [TokenCountCache](src/services/cache-service.ts:144).
  - LRU core + bulk operations: [BoundedLRUCache](src/utils/bounded-lru-cache.ts:6), [BoundedLRUCache.deleteWhere()](src/utils/bounded-lru-cache.ts:121), [BoundedLRUCache.keysWhere()](src/utils/bounded-lru-cache.ts:150).
  - Backward-compatible adapters: [enhancedFileContentCache](src/utils/enhanced-file-cache-adapter.ts:18), [tokenCountCache](src/utils/token-cache-adapter.ts:61).

Next priorities focus on extracting a shared worker-pool base to reduce duplication, consolidating file/path utilities into a cohesive module, and rationalizing workspace hooks by responsibility.

## 1. Architecture & Organization

### 1.1 Constants (Single Source of Truth)

- Authoritative constants barrel: [src/constants/index.ts](src/constants/index.ts:1), re-exporting:
  - Application constants: [src/constants/app-constants.ts](src/constants/app-constants.ts:1)
  - UI drag constants: [src/constants/workspace-drag-constants.ts](src/constants/workspace-drag-constants.ts:1)
  - Persistent keys: [STORAGE_KEYS](src/constants/index.ts:6)
  - UI sort options: [SORT_OPTIONS](src/constants/index.ts:22)
  - Default exclusion patterns aliased to shared list: [DEFAULT_EXCLUSION_PATTERNS](src/constants/index.ts:35) → [excludedFiles](src/shared/excluded-files.ts:1)
- Import policy:
  - Renderer/tests import via "@constants" and "@shared/*".
  - Main process may keep relative imports for IDE ergonomics (tsc-alias rewrites on build).

Guardrails:
- Constants are defined as immutable (as const) and accessed through the barrel.

### 1.2 Module Boundaries

- Tests import a top-level library file [lib/apply-changes.ts](lib/apply-changes.ts:1). Later consolidation will prefer housing all application sources under src for a single compilation root.

### 1.3 Component Structure

- Styles are colocated (e.g., [src/components/search-bar.css](src/components/search-bar.css:1)). A feature-folder structure may further clarify boundaries but is not required.

## 2. Code Quality & Redundancy

### 2.1 Dead & Unused Code (Removed)

- Legacy constants shim and unused JavaScript in the TypeScript codebase removed.
- Unused dependencies pruned from [package.json](package.json:1); electron-builder “asarUnpack” no longer includes unused packages.

### 2.2 Token Counting (Unified)

- Façade API consolidates counting across environments:
  - Facade class with environment-aware selection and fallbacks:
    - [TokenService](src/services/token-service.ts:24)
    - [TokenService.countTokens()](src/services/token-service.ts:48) with byte-based guard (TextEncoder) and preferred → available → estimate fallback.
    - [TokenService.countTokensBatch()](src/services/token-service.ts:105) detects backend batch support, falls back to per-item as needed.
    - Backends implement optional batch: [TokenServiceBackend.countTokensBatch()](src/services/token-service.ts:20).
  - Renderer backend (Worker pool):
    - [WorkerPoolBackend](src/services/token-service-renderer.ts:9)
    - [WorkerPoolBackend.countTokens()](src/services/token-service-renderer.ts:32)
    - [WorkerPoolBackend.countTokensBatch()](src/services/token-service-renderer.ts:42)
    - [createRendererTokenService()](src/services/token-service-renderer.ts:83), [getRendererTokenService()](src/services/token-service-renderer.ts:97), [cleanupRendererTokenService()](src/services/token-service-renderer.ts:104)
  - Main backend (tiktoken):
    - [TiktokenBackend](src/services/token-service-main.ts:11)
    - [TiktokenBackend.isAvailable()](src/services/token-service-main.ts:43)
    - [TiktokenBackend.countTokens()](src/services/token-service-main.ts:48)
    - [createMainTokenService()](src/services/token-service-main.ts:89), [getMainTokenService()](src/services/token-service-main.ts:103), [cleanupMainTokenService()](src/services/token-service-main.ts:110)
  - Integration:
    - Electron main uses the façade for counting in file loads: [countTokens()](src/main/main.ts:104) and cleans up on quit: [before-quit cleanup](src/main/main.ts:338)
    - Renderer hook manages a singleton façade instance with delayed cleanup:
      - [useTokenService()](src/hooks/use-token-service.ts:22)
      - Timer type cross-env safe: [cleanupTimer](src/hooks/use-token-service.ts:6)
      - Batch delegation: [useTokenService().countTokensBatch()](src/hooks/use-token-service.ts:66)

Policy notes:
- Size guard uses bytes, not characters, for memory realism.
- Sanitization in the tiktoken path removes markers/controls; when excessive, the façade falls back to estimation.

### 2.3 Caching (Converged)

- Unified cache service built on the LRU core with TTL:
  - [UnifiedCache<K,V>](src/services/cache-service.ts:20): hit/miss tracking + stats
  - [FileContentCache](src/services/cache-service.ts:106): file content + token count with size checks
  - [TokenCountCache](src/services/cache-service.ts:144): file or line-range keyed results with exact/prefix invalidation
  - Global accessors: [getFileContentCache()](src/services/cache-service.ts:186), [getTokenCountCache()](src/services/cache-service.ts:193)
- LRU core:
  - [BoundedLRUCache](src/utils/bounded-lru-cache.ts:6)
  - Bulk operations: [deleteWhere()](src/utils/bounded-lru-cache.ts:121), [keysWhere()](src/utils/bounded-lru-cache.ts:150)
- Adapters for backwards compatibility:
  - [enhancedFileContentCache](src/utils/enhanced-file-cache-adapter.ts:18)
  - [tokenCountCache](src/utils/token-cache-adapter.ts:61)

### 2.4 File/Path Utilities

- Related modules: [src/utils/file-processing.ts](src/utils/file-processing.ts:1), [src/utils/file-utils.ts](src/utils/file-utils.ts:1), [src/utils/path-utils.ts](src/utils/path-utils.ts:1). Consolidation into a cohesive “file-ops” suite is planned.

### 2.5 Workspace Hooks Scope

- Hooks include: [use-workspace-state.ts](src/hooks/use-workspace-state.ts:1), [use-database-workspace-state.ts](src/hooks/use-database-workspace-state.ts:1), [use-workspace-autosave.ts](src/hooks/use-workspace-autosave.ts:1), [use-workspace-cache.ts](src/hooks/use-workspace-cache.ts:1), [use-workspace-context.ts](src/hooks/use-workspace-context.ts:1), [use-workspace-drag.ts](src/hooks/use-workspace-drag.ts:1), [use-workspace-selection.ts](src/hooks/use-workspace-selection.ts:1). Rationalization into clear verticals is scheduled.

## 3. Dependencies & Imports

### 3.1 Current State

- Path aliases configured in [tsconfig.base.json](tsconfig.base.json:6):
  - "@constants" → [src/constants/index.ts](src/constants/index.ts:1)
  - "@constants/*" → [src/constants/*](src/constants)
  - "@shared/*" → [src/shared/*](src/shared)
- Renderer/tests use alias imports; main keeps relative paths for IDE stability with tsc-alias after compile.

### 3.2 Builder and Main TS Config

- Main compilation includes services explicitly: [tsconfig.main.json](tsconfig.main.json:23) ([token-service.ts](src/services/token-service.ts:24), [token-service-main.ts](src/services/token-service-main.ts:1)).

## 4. Workers & Pools

- Workers:
  - [src/workers/token-counter-worker.ts](src/workers/token-counter-worker.ts:1)
  - [src/workers/tree-builder-worker.ts](src/workers/tree-builder-worker.ts:1)
  - [src/workers/preview-generator-worker.ts](src/workers/preview-generator-worker.ts:1)
  - [src/workers/selection-overlay-worker.ts](src/workers/selection-overlay-worker.ts:1)
- Pools:
  - [TokenWorkerPool](src/utils/token-worker-pool.ts:1)
  - [TreeBuilderWorkerPool](src/utils/tree-builder-worker-pool.ts:1)

Recommendation:
- Extract a shared worker-pool base (init/ready handshake, timeouts, recovery, health checks) and refactor both pools to extend it.

## 5. Performance & Monitoring

Preserve and continue to leverage:
- [src/utils/memory-monitor.ts](src/utils/memory-monitor.ts:1)
- [src/utils/performance-monitor.ts](src/utils/performance-monitor.ts:1)
- [src/utils/file-viewer-performance.ts](src/utils/file-viewer-performance.ts:1)
- [src/utils/workspace-performance-comparison.ts](src/utils/workspace-performance-comparison.ts:1)
- [src/utils/cache-registry.ts](src/utils/cache-registry.ts:1)

## 6. Testing

- Test layout spans [src/__tests__/](src/__tests__:1), [src/hooks/__tests__/](src/hooks/__tests__:1), [src/main/db/__tests__/](src/main/db/__tests__:1), [src/utils/__tests__/](src/utils/__tests__:1).
- Add/maintain coverage for:
  - Façade selection and batch behavior across renderer/main
  - Byte-size guard for multibyte strings
  - Cleanup on quit path (main)
- Worker-related mocks to be consolidated after worker-pool base refactor:
  - [src/__tests__/setup/mock-token-worker-pool.ts](src/__tests__/setup/mock-token-worker-pool.ts:1)
  - [src/__tests__/setup/worker-mocks.ts](src/__tests__/setup/worker-mocks.ts:1)

## 7. Prioritized Actions

### Critical (Next)
1) Worker-pool base class
- Extract shared orchestration logic from token/tree builder pools; introduce base class with lifecycle, health checks, backoff, and recovery.

2) Cache monitoring and policy refinement
- Optionally enhance utilization stats to prune expired entries before metrics and standardize memory estimation across caches.

### High (Following)
3) Consolidate file/path utilities
- Merge [file-processing.ts](src/utils/file-processing.ts:1), [file-utils.ts](src/utils/file-utils.ts:1), [path-utils.ts](src/utils/path-utils.ts:1) into a cohesive “file-ops” suite with a stable API.

4) Workspace hooks convergence
- Reduce overlapping responsibilities into three vertical modules (core state & persistence, UI interactions, derived selectors/caches). Update tests accordingly.

5) Move root lib under src
- Relocate [lib/apply-changes.ts](lib/apply-changes.ts:1) to [src/lib/apply-changes.ts](src/lib/apply-changes.ts:1) and update test imports.

### Low (As Time Permits)
6) Component ergonomics
- Consider feature folders or co-located styles per component.

7) Test convention
- Choose and document a single convention for test placement to aid discoverability.

## 8. Migration Plan

- Phase 1 (Completed)
  - Consolidated constants at [src/constants/index.ts](src/constants/index.ts:1); defined [STORAGE_KEYS](src/constants/index.ts:6), [SORT_OPTIONS](src/constants/index.ts:22), and [DEFAULT_EXCLUSION_PATTERNS](src/constants/index.ts:35) (alias to [excludedFiles](src/shared/excluded-files.ts:1)).
  - Normalized imports to "@constants" and "@shared/*" across renderer/tests; main remains relative as needed (tsc-alias at build).
  - Removed dead code and unused dependencies; cleaned electron-builder asarUnpack.
  - Stabilized initialization effects; verified renderer and main builds.

- Phase 2 (Completed)
  - Token-service façade implemented with byte-based size guard, environment-specific backends, and batch counting:
    - Renderer: [WorkerPoolBackend](src/services/token-service-renderer.ts:9), [createRendererTokenService()](src/services/token-service-renderer.ts:83)
    - Main: [TiktokenBackend](src/services/token-service-main.ts:11), [createMainTokenService()](src/services/token-service-main.ts:89), cleanup integrated in [before-quit](src/main/main.ts:338)
    - Facade orchestration and batch: [TokenService.countTokens()](src/services/token-service.ts:48), [TokenService.countTokensBatch()](src/services/token-service.ts:105)
    - React hook lifecycle: [useTokenService()](src/hooks/use-token-service.ts:22)
  - Caching converged on unified LRU(+TTL):
    - Unified cache types: [FileContentCache](src/services/cache-service.ts:106), [TokenCountCache](src/services/cache-service.ts:144)
    - LRU core with O(n) bulk ops: [BoundedLRUCache](src/utils/bounded-lru-cache.ts:6), [deleteWhere()](src/utils/bounded-lru-cache.ts:121)
    - Backward-compatible adapters: [enhancedFileContentCache](src/utils/enhanced-file-cache-adapter.ts:18), [tokenCountCache](src/utils/token-cache-adapter.ts:61)

- Phase 3
  - Extract worker-pool base; converge workspace hooks; ensure tests/mocks align.

- Phase 4
  - Consolidate file/path utilities; move [lib/apply-changes.ts](lib/apply-changes.ts:1) under src; finalize import refactors as needed.

- Phase 5
  - Harden via full test suite, performance checks, and polish.

## 9. Metrics

- Token counting:
  - 100% of consumers routed through the façade; renderer/main backends verified
  - Batch path available in renderer; façade falls back when batch unsupported

- Caches:
  - All transient caches backed by [BoundedLRUCache](src/utils/bounded-lru-cache.ts:6) via unified implementations
  - Consistent invalidation and TTL policies; adapters preserved legacy APIs

- Imports:
  - Renderer/tests alias-based; main optionally relative (tsc-alias-rewritten)

- Dead code:
  - Zero unreferenced JS/TS modules in active paths

- Tests/Builds:
  - Suites run at acceptable coverage; renderer and main builds succeed

## 10. Risks

- Worker-pool base extraction (medium): mitigate with incremental refactors and consolidated mocks.
- Performance regressions (low): rely on current monitoring utilities and targeted benchmarks.
- Test churn (medium): hooks and worker refactors will require test updates.

## 11. Conclusion

The codebase now has a single constants source, a unified token-counting façade with environment-specific backends and batch support, and a converged cache foundation built on a single LRU(+TTL) implementation with adapters for backward compatibility. This reduces cognitive load and improves maintainability without sacrificing performance. Next, extract a common worker-pool base, consolidate file/path utilities into a single “file-ops” suite, and streamline workspace hooks. The sequencing balances risk and value while keeping builds stable and observability strong.