import type { FileData, SelectedFileReference, FileTreeMode } from "../types/file-types";

// Keep logic tiny and pure to simplify hook code and testing

export type LightweightFile = Pick<
  FileData,
  | "name"
  | "path"
  | "isDirectory"
  | "size"
  | "isBinary"
  | "isSkipped"
  | "error"
  | "fileType"
  | "isContentLoaded"
  | "tokenCount"
>;

export function computeNeedsFullTree(mode: FileTreeMode): boolean {
  return mode === "complete" || mode === "selected-with-roots";
}

// Build the minimal lightweight file descriptors to avoid structured clone overhead
export function buildLightweightFilesForStart(
  allFiles: FileData[],
  selectedFiles: SelectedFileReference[],
  mode: FileTreeMode
): LightweightFile[] {
  const byPath = new Map(allFiles.map((f) => [f.path, f]));

  // If full tree is requested, use all files directly; otherwise, just the selected ones resolved from the map
  const source = computeNeedsFullTree(mode)
    ? allFiles
    : selectedFiles
        .map((s) => byPath.get(s.path))
        .filter((f): f is FileData => Boolean(f));

  return source.map((f) => ({
    name: f.name,
    path: f.path,
    isDirectory: f.isDirectory,
    size: f.size,
    isBinary: f.isBinary,
    isSkipped: f.isSkipped,
    error: f.error,
    fileType: f.fileType,
    isContentLoaded: f.isContentLoaded,
    tokenCount: f.tokenCount,
  }));
}

export function computePercent(processed: number, total: number): number {
  const denom = Math.max(1, total);
  const pct = Math.round((processed / denom) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function appendToBuffers(
  currentDisplay: string,
  currentFull: string,
  displayPart: string | undefined,
  fullPart: string | undefined,
  truncationLimit: number
): { display: string; full: string } {
  const dp = displayPart ?? "";
  const fp = fullPart ?? "";
  const full = currentFull + fp;
  const combined = currentDisplay + dp;
  const display =
    combined.length > truncationLimit
      ? combined.slice(0, truncationLimit)
      : combined;
  return { display, full };
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  // Trim, collapse whitespace, and enforce a sane upper bound
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? normalized.slice(0, 500) + "…" : normalized;
}

