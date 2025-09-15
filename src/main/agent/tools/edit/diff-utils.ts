export type TextOccurrence = { start: number; end: number };

type UnifiedHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  body: string[];
};

export function findAllOccurrences(content: string, pattern: string, opts: { isRegex: boolean }): TextOccurrence[] {
  const out: TextOccurrence[] = [];
  if (!pattern) return out;
  if (opts.isRegex) {
    try {
      const re = new RegExp(pattern, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) != null) {
        const s = m.index;
        const e = s + (m[0]?.length ?? 0);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) { re.lastIndex = re.lastIndex + 1; continue; }
        out.push({ start: s, end: e });
        if (m[0]?.length === 0) re.lastIndex += 1;
        if (out.length >= 10_000) break;
      }
      return out;
    } catch {
      // Fall back to literal search when regex parse fails
    }
  }
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(pattern, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + pattern.length });
    from = idx + Math.max(1, pattern.length);
    if (out.length >= 10_000) break;
  }
  return out;
}

export function replaceByPolicy(
  original: string,
  occs: TextOccurrence[],
  replacement: string,
  policy: "first" | "all" | "index",
  index: number
): { modified: string; replacedIndex: number; replacements: number } {
  if (occs.length === 0) return { modified: original, replacedIndex: -1, replacements: 0 };
  if (policy === "first") {
    const t = occs[0];
    const modified = original.slice(0, t.start) + replacement + original.slice(t.end);
    return { modified, replacedIndex: 1, replacements: 1 };
  }
  if (policy === "index") {
    const clamped = Math.min(Math.max(1, index), occs.length) - 1;
    const t = occs[clamped];
    const modified = original.slice(0, t.start) + replacement + original.slice(t.end);
    return { modified, replacedIndex: clamped + 1, replacements: 1 };
  }
  let modified = original;
  const ordered = [...occs].sort((a, b) => b.start - a.start);
  for (const t of ordered) modified = modified.slice(0, t.start) + replacement + modified.slice(t.end);
  return { modified, replacedIndex: occs.length > 0 ? 1 : -1, replacements: occs.length };
}

export function parseUnifiedDiff(diffText: string): { hunks: UnifiedHunk[]; error?: string } {
  const lines = diffText.split(/\r?\n/);
  const hunks: UnifiedHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("@@")) {
      const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(l);
      if (!m) return { hunks, error: "Invalid hunk header" };
      const oldStart = Number(m[1]);
      const oldCount = Number(m[2] || "1");
      const newStart = Number(m[3]);
      const newCount = Number(m[4] || "1");
      i++;
      const body: string[] = [];
      while (i < lines.length && !lines[i].startsWith("@@")) {
        const hl = lines[i];
        if (/^([ +\\-])/.test(hl)) body.push(hl);
        else break;
        i++;
      }
      hunks.push({ oldStart, oldCount, newStart, newCount, body });
    } else {
      i++;
    }
  }
  return { hunks };
}

export function applyHunks(original: string, hunks: UnifiedHunk[]): { result: string; applied: boolean; error?: string } {
  const origLines = original.split(/\r?\n/);
  const out: string[] = [];
  let cursor = 0;
  for (const h of hunks) {
    const hStart = Math.max(0, h.oldStart - 1);
    if (hStart < cursor) return { result: original, applied: false, error: "Overlapping hunks not supported" };
    for (let k = cursor; k < hStart; k++) out.push(origLines[k] ?? "");
    cursor = hStart;
    for (const hl of h.body) {
      const tag = hl[0];
      const text = hl.slice(1);
      switch (tag) {
        case " ": {
          if ((origLines[cursor] ?? "") !== text) {
            return { result: original, applied: false, error: "Context mismatch while applying hunk" };
          }
          out.push(text);
          cursor++;
          break;
        }
        case "-": {
          if ((origLines[cursor] ?? "") !== text) {
            return { result: original, applied: false, error: "Removal mismatch while applying hunk" };
          }
          cursor++;
          break;
        }
        case "+": {
          out.push(text);
          break;
        }
        case "\\": {
          break;
        }
        default: {
          return { result: original, applied: false, error: "Invalid hunk line marker" };
        }
      }
    }
  }
  for (let k = cursor; k < origLines.length; k++) out.push(origLines[k] ?? "");
  return { result: out.join("\n"), applied: true };
}

export function applyUnifiedDiffSafe(original: string, diffText: string): { result: string; applied: boolean; error?: string } {
  try {
    const { hunks, error } = parseUnifiedDiff(diffText);
    if (error) return { result: original, applied: false, error };
    if (hunks.length === 0) {
      return { result: diffText, applied: false, error: "No hunks found; treated diff as full content" };
    }
    return applyHunks(original, hunks);
  } catch (error: unknown) {
    return { result: original, applied: false, error: String((error as { message?: string })?.message ?? error) };
  }
}
