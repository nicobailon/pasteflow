import path from "node:path";

export type LineRange = { start: number; end: number };

/**
 * Parse a comma-separated line range specification.
 * Examples:
 *  - "10-20,30,40-50" => [{10,20},{30,30},{40,50}]
 *  - "5" => [{5,5}]
 */
export function parseLineRanges(spec?: string): LineRange[] | undefined {
  if (!spec) return undefined;
  const parts = String(spec).split(",").map((s) => s.trim()).filter(Boolean);
  const ranges: LineRange[] = [];
  for (const p of parts) {
    if (p.includes("-")) {
      const [a, b] = p.split("-").map((x) => Number.parseInt(x.trim(), 10));
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) {
        throw new Error(`Invalid line range '${p}'`);
      }
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      ranges.push({ start, end });
    } else {
      const n = Number.parseInt(p, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid line number '${p}'`);
      }
      ranges.push({ start: n, end: n });
    }
  }
  if (ranges.length === 0) return undefined;
  return ranges;
}

/**
 * Ensure a given path is absolute. Returns the normalized absolute path string.
 * Throws an Error if not absolute.
 */
export function ensureAbsolutePath(p: string): string {
  if (!p || typeof p !== "string") {
    throw new Error("Path is required");
  }
  if (!path.isAbsolute(p)) {
    throw new Error("Absolute path required");
  }
  // Normalize to avoid surprises
  return path.normalize(p);
}