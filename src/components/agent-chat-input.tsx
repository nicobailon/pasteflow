import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileData } from "../types/file-types";
import { getRelativePath } from "../file-ops/path";
import { UI } from "../constants/app-constants";
import AgentFileAutocomplete, { AgentAutocompleteItem } from "./agent-file-autocomplete";

interface AgentChatInputWithMentionProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allFiles?: FileData[];
  selectedFolder?: string | null;
  onFileMention: (absPath: string, lines?: { start: number; end: number } | null) => void;
}

/**
 * AgentChatInputWithMention
 * - Textarea for Agent Panel with lightweight @-mention autocomplete
 * - Independent from main Content Area logic; does not mutate selection or expand tree
 * - Reuses dropdown visuals via .autocomplete-dropdown classes
 */
const AgentChatInputWithMention = memo(function AgentChatInputWithMention({
  value,
  onChange,
  disabled = false,
  allFiles = [],
  selectedFolder = null,
  onFileMention,
}: AgentChatInputWithMentionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [orientation, setOrientation] = useState<'up' | 'down'>('down');

  // Build searchable items from allFiles prop
  const items: AgentAutocompleteItem[] = useMemo(() => {
    if (!Array.isArray(allFiles) || allFiles.length === 0) return [];
    const base = allFiles
      .filter((f) => !f.isDirectory)
      .map((f) => {
        const rel = getRelativePath(f.path, selectedFolder || "");
        return {
          abs: f.path,
          rel,
          relLower: rel.toLowerCase(),
          size: f.size,
          tokenCount: f.tokenCount,
        } as AgentAutocompleteItem;
      });
    return base;
  }, [allFiles, selectedFolder]);

  // Simple query extraction like ContentArea: find "@token" before caret
  const computeQueryFromValue = useCallback((text: string, caret: number) => {
    const before = text.slice(0, Math.max(0, caret));
    const match = before.match(/@(\S*)$/);
    return match ? match[1] : null;
  }, []);

  // Cursor positioning helpers (approximate, like ContentArea)
  const metricsRef = useRef<{ lineHeight: number; fontSize: number; paddingLeft: number; charWidth: number }>({
    lineHeight: 24,
    fontSize: 14,
    paddingLeft: 12,
    charWidth: 7.7,
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const recompute = () => {
      const computed = window.getComputedStyle(el);
      const lineHeight = Number.parseInt(computed.lineHeight) || 24;
      const fontSize = Number.parseInt(computed.fontSize) || 14;
      const paddingLeft = Number.parseInt(computed.paddingLeft) || 12;
      const charWidth = fontSize * (UI?.INSTRUCTIONS_INPUT?.CHAR_WIDTH_FACTOR ?? 0.55);
      metricsRef.current = { lineHeight, fontSize, paddingLeft, charWidth };
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const getCursorCoordinates = useCallback((textarea: HTMLTextAreaElement, position: number) => {
    const textBeforeCursor = textarea.value.slice(0, Math.max(0, position));
    const textLines = textBeforeCursor.split("\n");
    const currentLine = textLines[textLines.length - 1];

    // Find the @ symbol position on current line
    const atMatch = currentLine.match(/@(\S*)$/);
    const atPosition = atMatch ? currentLine.length - atMatch[0].length : currentLine.length;

    const { lineHeight, paddingLeft: padding, charWidth } = metricsRef.current;
    const xPosition = padding + atPosition * charWidth;

    const currentLineY = (textLines.length - 1) * lineHeight;
    const dropdownOffset = 8;
    const yPosition = currentLineY + lineHeight + dropdownOffset + padding;

    const dropdownHeight = UI?.INSTRUCTIONS_INPUT?.DROPDOWN_MAX_HEIGHT ?? 200;
    const wouldOverflow = yPosition + dropdownHeight > textarea.offsetHeight;
    const finalY = wouldOverflow ? Math.max(5, currentLineY - dropdownHeight - dropdownOffset + padding) : yPosition;

    // Clamp X within collision padding
    const paddingX = 8;
    const maxLeft = Math.max(paddingX, textarea.offsetWidth - 250 - paddingX);
    const clampedLeft = Math.min(Math.max(paddingX, xPosition), maxLeft);

    // Update orientation state
    setOrientation(wouldOverflow ? 'up' : 'down');

    return {
      left: clampedLeft,
      top: finalY,
    };
  }, []);

  // Maintain a local filtered copy for keyboard acceptance
  const filteredItems: AgentAutocompleteItem[] = useMemo(() => {
    const qRaw = query.trim().toLowerCase();
    const q = qRaw.replace(/:\d+-\d+$/, "");
    if (!open) return [];
    if (!q) return items.slice(0, 12);
    // Light ranking: shortest rel first, then lexicographic
    const filtered = items.filter((it) => it.relLower.includes(q));
    filtered.sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
    return filtered.slice(0, 12);
  }, [open, query, items]);

  const updateAnchorDeferred = useCallback((ta: HTMLTextAreaElement, caret: number) => {
    requestAnimationFrame(() => {
      const pos = getCursorCoordinates(ta, caret);
      setAnchor(pos);
    });
  }, [getCursorCoordinates]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    const caret = e.target.selectionStart ?? text.length;
    const q = computeQueryFromValue(text, caret);
    if (q === null) {
      setOpen(false);
      setQuery("");
      return;
    }
    setQuery(q);
    setOpen(true);
    updateAnchorDeferred(e.target, caret);
  }, [onChange, computeQueryFromValue, updateAnchorDeferred]);

  const replaceMentionToken = useCallback((file: AgentAutocompleteItem) => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/@(\S*)$/);
    if (!match || match.index === undefined) return;
    const insertionStart = match.index; // where "@" starts
    // Preserve any typed range suffix like :10-20
    const typed = match[1] || "";
    const rangeMatch = typed.match(/:(\d+)-(\d+)$/);
    const suffix = rangeMatch ? `:${rangeMatch[1]}-${rangeMatch[2]}` : '';
    const newValue = before.slice(0, insertionStart) + "@" + file.rel + suffix + value.slice(caret);
    onChange(newValue);
    const lines = rangeMatch ? { start: Number(rangeMatch[1]), end: Number(rangeMatch[2]) } : null;
    onFileMention(file.abs, lines);
    // restore focus
    setTimeout(() => el.focus(), 0);
    setOpen(false);
  }, [value, onChange, onFileMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    const hasResults = filteredItems.length > 0;
    switch (e.key) {
      case "Enter":
      case "Tab": {
        if (!hasResults) return;
        e.preventDefault();
        replaceMentionToken(filteredItems[0]);
        break;
      }
      case "Escape": {
        e.preventDefault();
        setOpen(false);
        break;
      }
      default:
        // no-op
        break;
    }
  }, [open, filteredItems, replaceMentionToken]);

  // Click outside container closes dropdown
  useEffect(() => {
    const onDocMouseDown = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <div ref={containerRef} className="autocomplete-container" style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        className="agent-input"
        placeholder="Message the Agent… Type @ to mention files"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {open && (
        <AgentFileAutocomplete
          query={query}
          items={items}
          position={anchor}
          orientation={orientation}
          onSelect={(it) => replaceMentionToken(it)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
});

export default AgentChatInputWithMention;
