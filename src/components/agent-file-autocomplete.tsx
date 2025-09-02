import { memo, useEffect, useMemo, useRef, useState } from "react";

export interface AgentAutocompleteItem {
  abs: string;
  rel: string;
  relLower: string;
  size?: number;
  tokenCount?: number;
}

interface AgentFileAutocompleteProps {
  query: string;
  items: AgentAutocompleteItem[];
  position: { left: number; top: number };
  orientation?: 'up' | 'down';
  onSelect: (item: AgentAutocompleteItem) => void;
  onClose: () => void;
}

/**
 * AgentFileAutocomplete
 * - Visual-only dropdown for Agent Panel @-mention suggestions
 * - Parent (AgentChatInputWithMention) handles keyboard and caret logic
 * - Shares visual classes with Content Area's dropdown for consistency
 */
const AgentFileAutocomplete = memo(function AgentFileAutocomplete({
  query,
  items,
  position,
  orientation = 'down',
  onSelect,
  onClose,
}: AgentFileAutocompleteProps) {
  const [filtered, setFiltered] = useState<AgentAutocompleteItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Filter and rank results
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    const base = Array.isArray(items) ? items : [];
    if (!q) {
      setFiltered(base.slice(0, 12));
      setActiveIndex(0);
      return;
    }
    const filteredItems = base
      .filter((it) => it.relLower.includes(q))
      .sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
      .slice(0, 12);
    setFiltered(filteredItems);
    setActiveIndex(0);
  }, [query, items]);

  // Close on outside click
  useEffect(() => {
    const onDocMouseDown = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose]);

  const listId = useMemo(() => "agent-ac-" + Math.random().toString(36).slice(2), []);
  const descId = listId + "-desc";

  return (
    <>
      {/* Description for screen readers */}
      <div id={descId} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(1px, 1px, 1px, 1px)" }}>
        File suggestions. Use Up/Down to navigate, Enter to insert, Escape to close.
      </div>

      <div
        ref={containerRef}
        className={`autocomplete-dropdown autocomplete-dropdown--${orientation}`}
        style={{ left: position.left, top: position.top, position: "absolute" }}
        id={listId}
        role="listbox"
        aria-label="Agent file suggestions"
        aria-describedby={descId}
      >
        <div className="autocomplete-header">Files</div>
        {filtered.map((it, idx) => (
          <button
            key={it.abs}
            type="button"
            className={`autocomplete-item ${idx === activeIndex ? "active" : ""}`}
            role="option"
            aria-selected={idx === activeIndex}
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseDown={(e) => {
              // prevent textarea blur
              e.preventDefault();
              onSelect(it);
            }}
          >
            <span>{it.rel}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="autocomplete-item" aria-disabled>
            <span>No matches</span>
          </div>
        )}
      </div>
    </>
  );
});

export default AgentFileAutocomplete;
