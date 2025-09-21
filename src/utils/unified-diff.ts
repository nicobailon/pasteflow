export type UnifiedDiffHunk = Readonly<{
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  body: readonly string[];
}>;

export type ParseUnifiedDiffResult = Readonly<{
  hunks: readonly UnifiedDiffHunk[];
  error?: string;
}>;

const HUNK_HEADER_PATTERN = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Parses a unified diff string into discrete hunks.
 * The implementation mirrors the server-side diff utilities so renderer + main stay in sync.
 */
export function parseUnifiedDiff(diffText: string): ParseUnifiedDiffResult {
  if (typeof diffText !== "string" || diffText.trim().length === 0) {
    return { hunks: Object.freeze([]) } as const;
  }
  const lines = diffText.split(/\r?\n/);
  const hunks: UnifiedDiffHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      const match = HUNK_HEADER_PATTERN.exec(line);
      if (!match) {
        return { hunks: Object.freeze(hunks), error: "Invalid hunk header" } as const;
      }
      const oldStart = Number(match[1]);
      const oldCount = Number(match[2] || "1");
      const newStart = Number(match[3]);
      const newCount = Number(match[4] || "1");
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !lines[i].startsWith("@@")) {
        const hunkLine = lines[i];
        if (/^([ +\\-])/.test(hunkLine)) {
          body.push(hunkLine);
          i += 1;
          continue;
        }
        break;
      }
      hunks.push(Object.freeze({
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        body: Object.freeze([...body]),
      }));
      continue;
    }
    i += 1;
  }
  return { hunks: Object.freeze(hunks) } as const;
}
