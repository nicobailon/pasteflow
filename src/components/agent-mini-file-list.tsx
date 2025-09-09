import { useEffect, useMemo, useRef, useState } from "react";
import type { FileData } from "../types/file-types";
import { basename } from "../file-ops/path";
import { TOKEN_COUNTING } from "@constants";
import { requestFileContent } from "../handlers/electron-handlers";

export type AgentMiniFileListProps = {
  files: FileData[];
  selected: string[];
  onToggle: (path: string) => void;
  onTokenCount?: (path: string, tokens: number) => void;
  collapsed?: boolean;
  renderCap?: number;
};

/**
 * AgentMiniFileList
 * - Compact file list with client-side search and token counters
 * - Shows approximate tokens immediately; fetches precise on hover/selection
 */
export default function AgentMiniFileList({ files, selected, onToggle, onTokenCount, collapsed = false, renderCap = 200 }: AgentMiniFileListProps) {
  const [query, setQuery] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const [tokenCache, setTokenCache] = useState<Map<string, number>>(new Map());
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => () => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;
    return base.slice(0, renderCap);
  }, [files, query, renderCap]);

  function approxTokensFor(f: FileData): number {
    const precise = tokenCache.get(f.path);
    if (typeof precise === 'number') return precise;
    if (typeof f.tokenCount === 'number' && f.tokenCount > 0) return f.tokenCount;
    const approx = Math.ceil((f.size || 0) / TOKEN_COUNTING.CHARS_PER_TOKEN);
    return approx;
  }

  async function ensurePrecise(path: string) {
    try {
      if (tokenCache.has(path)) return;
      const res = await requestFileContent(path);
      if (res.success) {
        const t = typeof res.tokenCount === 'number' ? res.tokenCount : Math.ceil((res.content || '').length / TOKEN_COUNTING.CHARS_PER_TOKEN);
        setTokenCache((prev) => {
          if (prev.get(path) === t) return prev;
          const n = new Map(prev);
          n.set(path, t);
          return n;
        });
        onTokenCount?.(path, t);
      }
    } catch { /* ignore */ }
  }

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const totalSelectedTokens = useMemo(() => {
    let sum = 0;
    for (const p of selected) {
      const f = files.find((x) => x.path === p);
      if (!f) continue;
      const t = tokenCache.get(p) ?? (typeof f.tokenCount === 'number' && f.tokenCount > 0 ? f.tokenCount : Math.ceil((f.size || 0) / TOKEN_COUNTING.CHARS_PER_TOKEN));
      sum += t;
    }
    return sum;
  }, [selected, files, tokenCache]);

  return (
    <div className="agent-mini-file-list" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
        <button className="secondary" onClick={() => setIsCollapsed((v) => !v)} aria-label={isCollapsed ? 'Expand files' : 'Collapse files'} title={isCollapsed ? 'Expand files' : 'Collapse files'}>
          {isCollapsed ? '▸' : '▾'}
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Files</div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 6px', width: 140 }}
          aria-label="Search files"
        />
      </div>
      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflow: 'auto', padding: '4px 8px' }}>
          {filtered.map((f) => {
            const isSel = selectedSet.has(f.path);
            const tokens = approxTokensFor(f);
            return (
              <label
                key={f.path}
                title={f.path}
                onMouseEnter={() => {
                  if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = setTimeout(() => { void ensurePrecise(f.path); }, 120);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => {
                    onToggle(f.path);
                    // If selecting, try to fetch precise soon
                    if (!isSel) { void ensurePrecise(f.path); }
                  }}
                  aria-label={`Toggle ${f.name}`}
                />
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{basename(f.path)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{tokens}t</span>
              </label>
            );
          })}
          {filtered.length < (query ? files.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())).length : files.length) && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 0' }}>…more</div>
          )}
        </div>
      )}
      <div style={{ padding: '4px 8px', display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>{selected.length} selected</span>
        <span>•</span>
        <span>{totalSelectedTokens} tokens</span>
      </div>
    </div>
  );
}

