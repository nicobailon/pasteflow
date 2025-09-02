import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRelativePath, normalizePath } from "@file-ops/path";
import type { FileData } from "../types/file-types";

interface ChatInputWithMentionProps {
  onSend: (text: string) => void;
  onFileMention: (path: string, lines?: { start: number; end: number }) => void;
  disabled?: boolean;
  allFiles: FileData[];
  selectedFolder: string | null;
}

export function ChatInputWithMention({ onSend, onFileMention, disabled, allFiles, selectedFolder }: ChatInputWithMentionProps) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [caretPosition, setCaretPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorPos = useRef<{ top: number; left: number }>({ top: 0, left: 0 });

  const onSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  }, [onSend, value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const caret = e.target.selectionStart ?? newValue.length;
    setValue(newValue);
    setCaretPosition(caret);

    const beforeCaret = newValue.slice(0, caret);
    const mentionMatch = beforeCaret.match(/@([^\s]*)$/);
    if (mentionMatch) {
      setAutocompleteQuery(mentionMatch[1]);
      scheduleCoords(e.target, caret);
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  };

  const insertFileMention = useCallback((path: string) => {
    const text = value;
    const beforeCaret = text.slice(0, caretPosition);
    const afterCaret = text.slice(caretPosition);
    const atPosition = beforeCaret.lastIndexOf("@");
    const beforeAt = text.slice(0, atPosition);
    // Match content-area behavior: wrap relative path in backticks
    const mentionText = `\`${path}\``;
    const newValue = beforeAt + mentionText + afterCaret;
    setValue(newValue);
    setOpen(false);
    onFileMention(path);
    textareaRef.current?.focus();
  }, [value, caretPosition, onFileMention]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && results.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        setActiveIndex((i) => (i + dir + results.length) % results.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = results[activeIndex];
        if (it) insertFileMention(it.rel);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    if ((e.key === "Enter" || e.key === "Return") && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Build searchable list
  const fileItems = useMemo(() => {
    const root = selectedFolder || "";
    return allFiles
      .filter((f) => !f.isDirectory)
      .map((f) => {
        const rel = getRelativePath(normalizePath(f.path), normalizePath(root));
        return { abs: f.path, rel, relLower: rel.toLowerCase() };
      });
  }, [allFiles, selectedFolder]);

  const prefixIndex = useMemo(() => {
    const map = new Map<string, { abs: string; rel: string; relLower: string }[]>();
    for (const it of fileItems) {
      const key = it.relLower.slice(0, 2);
      const arr = map.get(key);
      if (arr) arr.push(it);
      else map.set(key, [it]);
    }
    return map;
  }, [fileItems]);

  const [debouncedQuery, setDebouncedQuery] = useState(autocompleteQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(autocompleteQuery), 50);
    return () => clearTimeout(t);
  }, [autocompleteQuery]);

  const results = useMemo(() => {
    if (!open) return [] as { abs: string; rel: string }[];
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return fileItems.slice(0, 12);
    const candidates = q.length >= 2 ? (prefixIndex.get(q.slice(0, 2)) || fileItems) : fileItems;
    const filtered = candidates.filter((it) => it.relLower.includes(q));
    filtered.sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
    return filtered.slice(0, 12);
  }, [open, debouncedQuery, fileItems, prefixIndex]);

  // Positioning helpers (approximate caret position)
  const metricsRef = useRef<{ lineHeight: number; paddingLeft: number; charWidth: number }>({ lineHeight: 24, paddingLeft: 12, charWidth: 7.7 });
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    metricsRef.current = {
      lineHeight: Number.parseInt(cs.lineHeight) || 24,
      paddingLeft: Number.parseInt(cs.paddingLeft) || 12,
      charWidth: (Number.parseInt(cs.fontSize) || 14) * 0.55,
    };
  }, []);

  const getCursorCoordinates = (textarea: HTMLTextAreaElement, position: number) => {
    const textBefore = textarea.value.slice(0, Math.max(0, position));
    const lines = textBefore.split('\n');
    const currentLine = lines[lines.length - 1];
    const atMatch = currentLine.match(/@([^\s]*)$/);
    const atPos = atMatch ? currentLine.length - atMatch[0].length : currentLine.length;
    const { lineHeight, paddingLeft, charWidth } = metricsRef.current;
    const x = paddingLeft + atPos * charWidth;
    const y = lines.length * lineHeight + 8; // place below line
    return { left: Math.min(x, textarea.offsetWidth - 250), top: y };
  };

  const scheduleCoords = (textarea: HTMLTextAreaElement, caret: number) => {
    requestAnimationFrame(() => {
      anchorPos.current = getCursorCoordinates(textarea, caret);
    });
  };

  return (
    <div className="chat-input-container" style={{ position: 'relative', display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Type @ to mention a file, or ask a question…"
        className="chat-input"
        style={{ minHeight: 60, padding: 8, borderRadius: 6, border: "1px solid #e5e7eb" }}
        disabled={disabled}
      />
      {open && results.length > 0 && (
        <div
          className="file-autocomplete-dropdown"
          style={{ position: 'absolute', left: anchorPos.current.left, top: anchorPos.current.top }}
        >
          <div className="autocomplete-header" style={{ padding: '6px 8px', fontSize: 12, color: '#9ca3af' }}>Files</div>
          {results.map((item, idx) => (
            <div
              key={item.abs}
              className={`autocomplete-item ${idx === activeIndex ? 'selected' : ''}`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => { e.preventDefault(); insertFileMention(item.rel); }}
            >
              <span className="file-path">{item.rel}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="send-button"
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatInputWithMention;
