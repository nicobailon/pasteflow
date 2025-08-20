/**
 * Utility functions and types shared across main/renderer/tests.
 */

/**
 * Get a safe, human-readable error message from an unknown error.
 * Standardize on this helper instead of ad-hoc `(error as Error)?.message`.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Exhaustiveness guard for discriminated unions.
 * Use at the end of a switch to ensure all variants are handled.
 */
export function assertNever(x: never, message = 'Unexpected value'): never {
  // eslint-disable-next-line no-console
  console.error(`[assertNever] ${message}:`, x);
  throw new Error(`${message}: ${String(x)}`);
}

/**
 * Branded type helper for domain-specific identifiers.
 * Example usage:
 *   export type WorkspaceId = Brand<string, 'WorkspaceId'>;
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Example brand for future adoption (not yet enforced across the codebase).
 * Consider gradually introducing this in DB/IPC types where helpful.
 */
export type WorkspaceId = Brand<string, 'WorkspaceId'>;