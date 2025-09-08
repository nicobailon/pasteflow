# TypeScript Type Safety Guidelines for LLM Coding Agents

Use this as your **operating manual** whenever you write or edit TypeScript. It is optimized to prevent type widening, forbid `any`, and preserve precise, provable constraints.

---

## Pre‑Change Checklist (conceptual)

Before making substantive code changes, **always**:

* **Clarify invariants**: Identify domain rules (e.g., “IDs are UUIDv4”, “status ∈ {active, suspended}”) and plan to encode them as types.
* **Locate boundaries**: Find all I/O edges (network, disk, env, JSON) and plan runtime validation + safe narrowing from `unknown`.
* **Pin literals**: Ensure object/array literals keep literal types (no widening) via `as const` and/or `satisfies`.
* **Design unions**: Model variability as discriminated unions with exhaustive handling.
* **Choose brands**: Introduce branded types for identifiers and domain strings (Email, Url, ISODate).
* **Set strictness**: Confirm compiler and linter rules enforce strict typing; plan fixes that *increase* precision.

---

## Core Directives (non‑negotiable)

* **Type widening is strictly forbidden.** Favor **Literal**, **Union**, **Discriminant**, **Readonly**, **Brand**, **Template Literal**, **Mapped**, and **Conditional** types.
* **No `any` (or `unknown` misused as `any`).** Do not suppress errors with casts or comments.
* **Strict type safety is mandatory.** Exhaust *all* precise options before *any* relaxation. If precision cannot be maintained, stop and request/define missing invariants.

---

## Compiler & Lint Baseline

Configure (or assume) these flags at minimum:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "useUnknownInCatchVariables": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Lint rules to enforce safety (names may vary per setup):

* `@typescript-eslint/no-explicit-any`: **error**
* `@typescript-eslint/no-unsafe-*` (assignment, call, member-access, argument): **error**
* `@typescript-eslint/consistent-type-definitions`: prefer `type`
* `@typescript-eslint/switch-exhaustiveness-check`: **error**
* Disallow `// @ts-ignore` and `// @ts-expect-error` except with a justification tag and a TODO with deadline.

---

## Critical Type Safety Rules

### Anti‑Patterns (Never Do This)

```ts
// ❌ Widening or suppressing constraints
const schema = z.object({
  email: z.any(),         // loses validation
  role: z.string(),       // loses enum constraint
  status: z.any()         // loses literal type
});

function processData(input: any): any { /* ... */ } // NO

type UserId = string; // NO — use a brand

// ❌ Widening literals
const cfg = { retries: 3 }; // type: { retries: number } (widened)

// ❌ Casting away problems
const user = JSON.parse(s) as User; // NO runtime validation
```

### Best Practices (Always Do This)

```ts
// ✅ Keep precision & constraints
const schema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "user", "moderator"]),
  status: z.literal("active"),
});

const config = {
  apiUrl: "https://api.com",
  timeout: 5000,
  retries: 3,
} as const; // literal types preserved

type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, "UserId">;

// ✅ Prefer satisfies to check shape while preserving literals
const routes = {
  home: "/",
  settings: "/settings",
} as const satisfies Record<string, `/${string}`>;
```

---

## Precision‑By‑Design Patterns

### 1) Literal Preservation & Anti‑Widening

* Use `as const` on config/lookup tables and tuples.
* Use `satisfies` to **validate shape** without losing literal specificity:

  ```ts
  const roles = ["admin", "user", "moderator"] as const;
  type Role = (typeof roles)[number];
  const roleToPerms = {
    admin: ["*"],
    user: ["read"],
    moderator: ["read", "mute"]
  } as const satisfies Record<Role, readonly string[]>;
  ```
* Initialize empty collections with explicit element types:

  ```ts
  const queue: Array<JobId> = [];
  const map: Map<UserId, Profile> = new Map();
  ```

### 2) Discriminated Unions & Exhaustiveness

Model variants as unions; handle **all** cases:

```ts
type Loading = { kind: "loading" };
type Loaded<T> = { kind: "loaded"; data: T };
type Failed<E extends string> = { kind: "failed"; error: E };
type RemoteData<T, E extends string> = Loading | Loaded<T> | Failed<E>;

function fold<T, E extends string, R>(rd: RemoteData<T, E>, fns: {
  loading: () => R;
  loaded: (d: T) => R;
  failed: (e: E) => R;
}): R {
  switch (rd.kind) {
    case "loading": return fns.loading();
    case "loaded":  return fns.loaded(rd.data);
    case "failed":  return fns.failed(rd.error);
    default: {
      const _exhaustive: never = rd; // forces future cases
      return _exhaustive;
    }
  }
}
```

### 3) Branded Domain Types

Use brands for identifiers and validated strings:

```ts
type Uuid = Brand<string, "Uuid">;
type Email = Brand<string, "Email">;
type HttpsUrl = Brand<string, "HttpsUrl">;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is Uuid =>
  typeof v === "string" && uuidRe.test(v);

export function assertUuid(v: unknown): asserts v is Uuid {
  if (!isUuid(v)) throw new Error("Invalid Uuid");
}
```

### 4) Boundary Safety (I/O, JSON, Env)

All external data is `unknown` until validated.

```ts
// JSON parsing pattern
function parseUser(json: string): Result<User, "InvalidJson" | "InvalidShape"> {
  let raw: unknown;
  try { raw = JSON.parse(json) as unknown; } // keep as unknown
  catch { return { ok: false, error: "InvalidJson" } as const; }

  const parsed = schema.safeParse(raw);
  return parsed.success
    ? ({ ok: true, value: parsed.data } as const)
    : ({ ok: false, error: "InvalidShape" } as const);
}
```

### 5) Function Signatures & Generics

* Annotate **exported** functions explicitly; allow internal inference if it preserves precision.
* Constrain generics to their **actual** domain:

  ```ts
  function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> { /*...*/ }
  ```
* Use overloads or conditional types for precision:

  ```ts
  function get<K extends keyof T, T extends object>(obj: T, key: K): T[K] { /*...*/ }
  ```

### 6) Collections & Index Signatures

* Prefer keyed objects with **exact** keys over loose index signatures.
* When index signatures are unavoidable, set value types precisely and enable `noUncheckedIndexedAccess`.
* Use `ReadonlyArray<T>` / `readonly T[]` and `readonly [A,B]` tuples where mutation is not required.

### 7) Enums & Constants

* Avoid runtime `enum`. Prefer **union of literals** or `as const` + `keyof typeof`.
* If build system supports it, `const enum` is acceptable to avoid runtime emission (only with clear constraints).

---

## Type Narrowing Cheat Sheet

Use these to move from `unknown`/union to precise types:

1. **typeof guards** — `if (typeof v === "string") { /* v: string */ }`
2. **Truthiness** — `if (arr.length) { /* arr: readonly T[] & { length: number & > 0 } (conceptually) */ }`
3. **Equality** — `if (v === null) { /* v: null */ }`
4. **`in` operator** — `if ("kind" in x) { /* narrow via discriminant */ }`
5. **`instanceof`** — `if (e instanceof Error) { /* e: Error */ }`
6. **Control‑flow analysis** — `return`/`throw` to refine remaining branches.
7. **Type predicates** — `function isEmail(v: unknown): v is Email { ... }`
8. **Assertion functions** — `function assertUuid(v: unknown): asserts v is Uuid { ... }`
9. **Exhaustiveness with `never`** — force handling all union members.
10. **`satisfies` operator** — check conformance while keeping literals:

    ```ts
    const x = { tag: "A", value: 1 } as const satisfies { tag: "A" | "B"; value: number };
    ```

---

## Type Problem Resolution Protocol (apply **in order**)

1. **Analyze the Root Cause**

   * Identify where widening happened (e.g., implicit `number` vs `1`, inferred `string` vs `"ok"`).
   * Check `const` vs `let` and missing `as const`.
   * Look for missing or overly‑loose generic constraints.
   * Verify discriminants on unions and `never` exhaustiveness.
2. **Apply Precision Fixes**

   1. Add `as const` to literals/tuples; use `readonly` for immutability.
   2. Replace vague annotations with **narrow** ones (literal unions, branded types).
   3. Introduce/strengthen **generic constraints** (`extends`).
   4. Add **brands** for domain values and pair them with guards/asserts.
   5. Replace `enum` / string with **union of literals** and discriminants.
   6. Use `satisfies` to validate shapes without widening.
3. **Validate Every Fix**

   * Recompile with `--strict`; **no** implicit or explicit `any`.
   * Confirm runtime invariants via tests or schema validation.
   * Ensure business constraints remain enforced (e.g., email format, enum membership).
   * Prefer **increased** precision vs. lateral changes.
4. **If Still Failing**

   * Document which attempts failed and why.
   * Escalate to advanced tools:

     * **Discriminated unions** with richer variants
     * **Conditional types** with `infer`
     * **Mapped types** (including key remapping)
     * **Template literal types** for string formats (e.g., `https://${string}`)
     * **Result/Either** types instead of exceptions across boundaries

---

## Additional Guardrails & Patterns

### Safe Error Handling

```ts
try { /* ... */ }
catch (e: unknown) {
  if (e instanceof Error) log(e.message);
  else log(String(e));
}
```

### Never Assert Without Proof

* Avoid `as Type` unless paired with a preceding guard/validation that *proves* it.
* Never use double casts like `value as unknown as T`.

### Public API Contracts

* Export **types** and **type‑only** imports/exports (`import type` / `export type`) to avoid runtime bleed‑through.
* On exported functions/components, prefer explicit param/return types.

### Index Safety

```ts
function getOrThrow<T>(arr: readonly T[], index: number): T {
  const v = arr[index];
  if (v === undefined) throw new Error("Index out of bounds");
  return v;
}
```

### Result Types Over Exceptions (at boundaries)

```ts
type Ok<T> = { ok: true; value: T };
type Err<E extends string> = { ok: false; error: E };
type Result<T, E extends string> = Ok<T> | Err<E>;
```

### Schema‑Driven Validation (optional libraries)

* Prefer a single source of truth: define runtime schema (e.g., Zod/Valibot/typia) and derive static types via `z.infer<typeof Schema>`.
* Never annotate parsed JSON directly; always validate first.

---

## Worked Micro‑Examples

**Discriminated union + exhaustive switch**

```ts
type Step = { type: "start" } | { type: "progress"; pct: 0|25|50|75|100 } | { type: "done" };

function render(step: Step): string {
  switch (step.type) {
    case "start":    return "Starting…";
    case "progress": return `Progress: ${step.pct}%`;
    case "done":     return "Done";
    default: {
      const _x: never = step; return _x;
    }
  }
}
```

**Template literal & brand**

```ts
type Path = `/${string}`;
type RouteName = "home" | "settings";
type RouteMap = Record<RouteName, Path>;

const routes = {
  home: "/",
  settings: "/settings",
} as const satisfies RouteMap;
```

**Narrowing from `unknown`**

```ts
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
```

---

## Your Commitment (as the coding agent)

* You **must not** introduce or leave behind `any`, loose casts, or widened types.
* You **must** model domain rules in types, validate at boundaries, and prove narrowing.
* You **must** maintain or increase type precision with every change, documenting trade‑offs if constraints are incomplete.
* If a requirement cannot be expressed precisely with available information, **stop** and request/define the missing invariant rather than weakening types.

---

### TL;DR

* **No widening. No `any`. Full strictness.**
* Encode invariants as **brands**, **literal unions**, and **discriminated unions**.
* Guard all **boundaries** (`unknown` → validate → narrow).
* Prefer `as const` + `satisfies`, exhaustive switches, and `never` checks.
* Use **generics with constraints**, **mapped/conditional types**, and **template literal types** to keep precision end‑to‑end.
