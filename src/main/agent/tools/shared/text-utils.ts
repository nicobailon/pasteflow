export function clipText(s: string, max = 40_000): string {
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s;
}

export function charDiff(a: string, b: string): { op: "keep" | "add" | "del"; text: string }[] {
  try {
    if (a === b) return [{ op: "keep", text: a.slice(0, Math.min(1000, a.length)) }];
    let i = 0;
    const maxScan = Math.min(a.length, b.length);
    while (i < maxScan && (a.codePointAt(i) ?? -1) === (b.codePointAt(i) ?? -2)) i++;
    let j = 0;
    const aRem = a.length - i;
    const bRem = b.length - i;
    while (j < aRem && j < bRem && (a.codePointAt(a.length - 1 - j) ?? -1) === (b.codePointAt(b.length - 1 - j) ?? -2)) j++;
    const keepPrefix = a.slice(0, i);
    const delMid = a.slice(i, a.length - j);
    const addMid = b.slice(i, b.length - j);
    const keepSuffix = a.slice(a.length - j);
    const out: { op: "keep" | "add" | "del"; text: string }[] = [];
    if (keepPrefix) out.push({ op: "keep", text: keepPrefix.slice(0, 1000) });
    if (delMid) out.push({ op: "del", text: delMid.slice(0, 2000) });
    if (addMid) out.push({ op: "add", text: addMid.slice(0, 2000) });
    if (keepSuffix) out.push({ op: "keep", text: keepSuffix.slice(-1000) });
    return out;
  } catch {
    return [{ op: "keep", text: a.slice(0, 1000) }];
  }
}

export function contextLines(content: string, occ: { start: number; end: number }, n: number): { before: string[]; after: string[] } {
  try {
    const lines = content.split(/\r?\n/);
    let acc = 0;
    let lineAtStart = 0;
    for (const [i, line] of lines.entries()) {
      const next = acc + line.length + 1;
      if (occ.start < next) { lineAtStart = i; break; }
      acc = next;
    }
    const startIdx = Math.max(0, lineAtStart - n);
    const endIdx = Math.min(lines.length, lineAtStart + n + 1);
    const before = lines.slice(startIdx, lineAtStart);
    const after = lines.slice(lineAtStart + 1, endIdx);
    return { before, after };
  } catch {
    return { before: [], after: [] };
  }
}
