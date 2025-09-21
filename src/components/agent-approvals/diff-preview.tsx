import { useCallback, useMemo, useState } from "react";

import { parseUnifiedDiff, type UnifiedDiffHunk } from "../../utils/unified-diff";

type TokenCounts = Readonly<{ original?: number; modified?: number }>;

type DiffPreviewDetail = Readonly<{
  diff?: string | null;
  original?: string | null;
  modified?: string | null;
  tokenCounts?: TokenCounts | null;
  existed?: boolean | null;
  applied?: boolean | null;
  error?: string | null;
  bytes?: number | null;
}>;

type DiffPreviewProps = Readonly<{ detail: DiffPreviewDetail; collapsedByDefault?: boolean }>;

type LineKind = "context" | "added" | "removed" | "meta";

type LineEntry = Readonly<{
  key: string;
  marker: string;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  kind: LineKind;
}>;

type HunkViewModel = Readonly<{
  index: number;
  header: string;
  rows: readonly LineEntry[];
  isLarge: boolean;
}>;

const HUNK_COLLAPSE_THRESHOLD = 120;
const MAX_FALLBACK_LENGTH = 10_000;
const NBSP = "\u00A0";

function coerceNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function buildHunkViewModels(hunks: readonly UnifiedDiffHunk[]): readonly HunkViewModel[] {
  return hunks.map((hunk, index) => {
    const rows: LineEntry[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (let rowIndex = 0; rowIndex < hunk.body.length; rowIndex += 1) {
      const rawLine = hunk.body[rowIndex];
      const marker = rawLine.charAt(0);
      const text = rawLine.slice(1);
      switch (marker) {
        case " ": {
          rows.push(Object.freeze({
            key: `${index}:${rowIndex}`,
            marker,
            text,
            oldLine,
            newLine,
            kind: "context" as const,
          }));
          oldLine += 1;
          newLine += 1;
          break;
        }
        case "-": {
          rows.push(Object.freeze({
            key: `${index}:${rowIndex}`,
            marker,
            text,
            oldLine,
            newLine: null,
            kind: "removed" as const,
          }));
          oldLine += 1;
          break;
        }
        case "+": {
          rows.push(Object.freeze({
            key: `${index}:${rowIndex}`,
            marker,
            text,
            oldLine: null,
            newLine,
            kind: "added" as const,
          }));
          newLine += 1;
          break;
        }
        case "\\": {
          rows.push(Object.freeze({
            key: `${index}:${rowIndex}`,
            marker,
            text: rawLine,
            oldLine: null,
            newLine: null,
            kind: "meta" as const,
          }));
          break;
        }
        default: {
          // Fall back to treating the entire line as context when it lacks a marker
          rows.push(Object.freeze({
            key: `${index}:${rowIndex}`,
            marker: " ",
            text: rawLine,
            oldLine,
            newLine,
            kind: "context" as const,
          }));
          oldLine += 1;
          newLine += 1;
          break;
        }
      }
    }
    return Object.freeze({
      index,
      header: hunk.header,
      rows: Object.freeze([...rows]),
      isLarge: rows.length > HUNK_COLLAPSE_THRESHOLD,
    });
  });
}

function truncate(text: string | null | undefined, max = MAX_FALLBACK_LENGTH): string | null {
  if (typeof text !== "string") return text ?? null;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (truncated)`;
}

export default function DiffPreview({ detail, collapsedByDefault = true }: DiffPreviewProps) {
  const diffText = typeof detail.diff === "string" ? detail.diff : "";
  const parseResult = useMemo(() => parseUnifiedDiff(diffText), [diffText]);
  const hunks = useMemo(() => buildHunkViewModels(parseResult.hunks), [parseResult.hunks]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = { ...prev };
      next[index] = !prev[index];
      return next;
    });
  }, []);

  const tokenCounts = detail.tokenCounts ?? null;
  const originalTokens = tokenCounts?.original ?? null;
  const modifiedTokens = tokenCounts?.modified ?? null;
  const existed = detail.existed ?? null;
  const applied = detail.applied ?? null;
  const bytes = coerceNumber(detail.bytes);
  const hasBytes = typeof bytes === "number";
  const hasOriginalTokens = typeof originalTokens === "number";
  const hasModifiedTokens = typeof modifiedTokens === "number";
  const hasTokenCounts = hasOriginalTokens || hasModifiedTokens;

  const fallbackOriginal = truncate(detail.original);
  const fallbackModified = truncate(detail.modified);

  const renderHunk = (hunk: HunkViewModel) => {
    const defaultExpanded = collapsedByDefault === false;
    const overrideExpanded = expanded[hunk.index];
    const isExpanded = hunk.isLarge ? (overrideExpanded ?? defaultExpanded) : true;
    const visibleRows = isExpanded ? hunk.rows : hunk.rows.slice(0, HUNK_COLLAPSE_THRESHOLD);
    const hiddenCount = hunk.rows.length - visibleRows.length;
    return (
      <section key={hunk.index} className="diff-preview__hunk" aria-label={`Diff hunk ${hunk.index + 1}`}>
        <header className="diff-preview__hunk-header">
          <span className="diff-preview__hunk-title">{hunk.header}</span>
          {hunk.isLarge ? (
            <button
              type="button"
              className="diff-preview__toggle"
              onClick={() => toggle(hunk.index)}
            >
              {isExpanded ? "Collapse" : `Expand ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </header>
        <div className="diff-preview__lines" role="group">
          {visibleRows.map((line) => (
            <div key={line.key} className={`diff-preview__line diff-preview__line--${line.kind}`}>
              <span className="diff-preview__line-number diff-preview__line-number--old">{line.oldLine ?? NBSP}</span>
              <span className="diff-preview__line-number diff-preview__line-number--new">{line.newLine ?? NBSP}</span>
              <span className="diff-preview__marker" aria-hidden="true">{line.marker}</span>
              <code className="diff-preview__code">{line.text.length > 0 ? line.text : NBSP}</code>
            </div>
          ))}
          {hiddenCount > 0 && isExpanded === false ? (
            <div className="diff-preview__collapsed-indicator" aria-live="polite">
              … {hiddenCount} line{hiddenCount === 1 ? "" : "s"} hidden
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  let bodyContent: JSX.Element | null = null;
  if (hunks.length > 0) {
    const renderedHunks = hunks.map((entry) => renderHunk(entry));
    bodyContent = (
      <div className="diff-preview__hunks">
        {renderedHunks}
      </div>
    );
  } else if (diffText) {
    bodyContent = (
      <pre className="diff-preview__raw" aria-label="Raw diff preview">{truncate(diffText) ?? "(empty diff)"}</pre>
    );
  } else {
    bodyContent = (
      <div className="diff-preview__fallback">
        <div className="diff-preview__fallback-column">
          <header>Original</header>
          <pre>{fallbackOriginal ?? "(not available)"}</pre>
        </div>
        <div className="diff-preview__fallback-column">
          <header>Modified</header>
          <pre>{fallbackModified ?? "(not available)"}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-preview">
      <div className="diff-preview__meta" role="note">
        {typeof existed === "boolean" ? (
          <span className="diff-preview__meta-item">Source file: {existed ? "existing" : "new"}</span>
        ) : null}
        {typeof applied === "boolean" ? (
          <span className="diff-preview__meta-item">Can auto-apply: {applied ? "yes" : "no"}</span>
        ) : null}
        {hasBytes ? (
          <span className="diff-preview__meta-item">{bytes.toLocaleString()} bytes</span>
        ) : null}
        {hasTokenCounts ? (
          <span className="diff-preview__meta-item">
            Tokens: {hasOriginalTokens ? originalTokens.toLocaleString() : "?"} → {hasModifiedTokens ? modifiedTokens.toLocaleString() : "?"}
          </span>
        ) : null}
        {detail.error ? (
          <span className="diff-preview__meta-item diff-preview__meta-item--warning">{detail.error}</span>
        ) : null}
      </div>

      {parseResult.error ? (
        <div className="diff-preview__warning" role="alert">{parseResult.error}</div>
      ) : null}

      {bodyContent}
    </div>
  );
}
