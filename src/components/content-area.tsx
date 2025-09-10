import { Check, ChevronDown, Eye, FileText, Settings, User, Eraser, Package } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FEATURES, UI, TOKEN_COUNTING } from '@constants';
import { getRelativePath, dirname, normalizePath } from '@file-ops/path';

import { logger } from '../utils/logger';
import { usePreviewPack } from '../hooks/use-preview-pack';
import { FileData, Instruction, LineRange, RolePrompt, SelectedFileReference, SystemPrompt, FileTreeMode } from '../types/file-types';


import CopyButton from './copy-button';
import Dropdown from './dropdown';
import FileList from './file-list';
import ClipboardPreviewModal from './clipboard-preview-modal';
import './content-area.css';
import SendToAgentButton from './send-to-agent-button';

// Helper: find @mention span preceding caret
const computeQueryFromValue = (text: string, caret: number) => {
  const before = text.slice(0, caret);
  const match = before.match(/@(\S*)$/);
  if (match) {
    return match[1];
  }
  return null;
};

// Helper: determine batch size and pacing based on selection size
const getBatchConfig = (selectionCount: number) => {
  let batch = 10;
  let delayMs = 25;
  if (selectionCount >= 1000) { batch = 40; delayMs = 8; }
  else if (selectionCount >= 500) { batch = 30; delayMs = 12; }
  else if (selectionCount >= 200) { batch = 20; delayMs = 16; }
  else if (selectionCount >= 80)  { batch = 14; delayMs = 20; }
  return { batch, delayMs };
};

// Helper: collect pending file paths and error paths from selection
const collectPendingAndErrors = (
  selectedFiles: SelectedFileReference[],
  byPath: Map<string, FileData>
) => {
  const pending: string[] = [];
  const errorFiles: string[] = [];
  for (const sel of selectedFiles) {
    const fd = byPath.get(sel.path);
    if (!fd) continue;
    if (fd.isDirectory) continue;
    if (fd.isBinary || fd.isSkipped) continue;
    if (fd.error && /binary/i.test(String(fd.error))) continue;
    if (fd.error && !fd.isContentLoaded) {
      errorFiles.push(sel.path);
      continue;
    }
    if (fd.isContentLoaded || fd.isCountingTokens) continue;
    pending.push(sel.path);
  }
  return { pending, errorFiles };
};

// Helper: report error status to worker for a list of paths
const reportErrors = (
  paths: string[],
  byPath: Map<string, FileData>,
  reported: Set<string>,
  pushFileStatus?: (path: string, status: 'error', message?: string) => void
) => {
  if (!pushFileStatus || paths.length === 0) return;
  for (const path of paths) {
    if (reported.has(path)) continue;
    const fd = byPath.get(path);
    pushFileStatus(path, 'error', fd?.error || 'Failed to load file');
    reported.add(path);
  }
};

// Minimal inline component implementing @path autocomplete for the instructions textarea only
const InstructionsTextareaWithPathAutocomplete = memo(({
  allFiles,
  selectedFolder,
  expandedNodes,
  toggleExpanded,
  value,
  onChange,
  onSelectFilePath,
}: {
  allFiles: FileData[];
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (path: string, currentState?: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  onSelectFilePath: (absolutePath: string) => void;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [valueDraft, setValueDraft] = useState<string>(value);
  const listboxIdRef = useRef<string>('instructions-ac-' + Math.random().toString(36).slice(2));
  const descIdRef = useRef<string>(listboxIdRef.current + '-desc');
  const liveIdRef = useRef<string>(listboxIdRef.current + '-live');

  // Feature flag: enable local draft typing decoupling
  const features = (window as any).__PF_FEATURES ?? FEATURES;
  const useLocalDraft = features?.USER_INSTRUCTIONS_LOCAL_DRAFT !== false; // default true

  // Keep local draft in sync when external value changes (e.g., workspace load)
  useEffect(() => {
    if (!useLocalDraft) return;
    setValueDraft(prev => (prev === value ? prev : value));
  }, [value, useLocalDraft]);

  // Small debounce for syncing local draft -> global state to reduce re-renders
  useEffect(() => {
    if (!useLocalDraft) return;
    const t = setTimeout(() => {
      if (valueDraft !== value) {
        onChange(valueDraft);
      }
    }, UI.INSTRUCTIONS_INPUT.DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [valueDraft, value, onChange, useLocalDraft]);

  // Build searchable list once per allFiles change
  const fileItems = useMemo(() => {
    const root = selectedFolder || "";
    return allFiles
      .filter((f) => !f.isDirectory)
      .map((f) => {
        const rel = getRelativePath(normalizePath(f.path), normalizePath(root));
        const relLower = rel.toLowerCase();
        return { abs: f.path, rel, relLower };
      });
  }, [allFiles, selectedFolder]);

  // Build a tiny prefix index (first 2 chars) to reduce search space for short queries
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

  // Filter results based on current query
  // Debounce query slightly to avoid filtering on every keystroke
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), UI.INSTRUCTIONS_INPUT.QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    if (!open) return [] as { abs: string; rel: string }[];
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) {
      return fileItems.slice(0, 12);
    }
    // Narrow candidates using prefix index when possible
    const candidates = q.length >= 2 ? (prefixIndex.get(q.slice(0, 2)) || fileItems) : fileItems;
    // Case-insensitive partial match against rel path (use precomputed relLower)
    const filtered = candidates.filter((it) => it.relLower.includes(q));
    // Light sort: shortest rel path first then lexicographic
    filtered.sort((a, b) => a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
    return filtered.slice(0, 12);
  }, [fileItems, debouncedQuery, open, prefixIndex]);

  // Calculate cursor position in pixels
  // Cache style metrics to avoid repeated layout reads
  const metricsRef = useRef<{ lineHeight: number; fontSize: number; paddingLeft: number; charWidth: number }>({
    lineHeight: 24,
    fontSize: 14,
    paddingLeft: 16,
    charWidth: 7.7,
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const recompute = () => {
      const computed = window.getComputedStyle(el);
      const lineHeight = Number.parseInt(computed.lineHeight) || 24;
      const fontSize = Number.parseInt(computed.fontSize) || 14;
      const paddingLeft = Number.parseInt(computed.paddingLeft) || 16;
      const charWidth = fontSize * UI.INSTRUCTIONS_INPUT.CHAR_WIDTH_FACTOR;
      metricsRef.current = { lineHeight, fontSize, paddingLeft, charWidth };
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  const getCursorCoordinates = useCallback((textarea: HTMLTextAreaElement, position: number) => {
    // Get text before cursor to calculate position
    const textBeforeCursor = textarea.value.slice(0, Math.max(0, position));
    const textLines = textBeforeCursor.split('\n');
    const currentLine = textLines[textLines.length - 1];
    
    // Find the @ position in the current line
    const atMatch = currentLine.match(/@(\S*)$/);
    const atPosition = atMatch ? currentLine.length - atMatch[0].length : currentLine.length;
    
    // Get computed styles for measurements
    const { lineHeight, paddingLeft: padding, charWidth } = metricsRef.current;
    
    // Calculate horizontal position - align with @ symbol
    const xPosition = padding + (atPosition * charWidth);
    
    // Calculate vertical position - place just below the current line
    const currentLineY = (textLines.length - 1) * lineHeight;
    const dropdownOffset = 8; // Small gap between text and dropdown
    const yPosition = currentLineY + lineHeight + dropdownOffset + padding;
    
    // Check if dropdown would go outside textarea bounds
    const dropdownHeight = UI.INSTRUCTIONS_INPUT.DROPDOWN_MAX_HEIGHT; // Max height from CSS
    const wouldOverflow = yPosition + dropdownHeight > textarea.offsetHeight;
    
    // If it would overflow, place above the line instead
    const finalY = wouldOverflow 
      ? Math.max(5, currentLineY - dropdownHeight - dropdownOffset + padding)
      : yPosition;
    
    return {
      x: Math.min(xPosition, textarea.offsetWidth - 250), // Keep within textarea bounds
      y: finalY
    };
  }, []);

  // Ensure parent folders expanded to reveal the file
  const ensureAncestorsExpanded = (absPath: string) => {
    if (!selectedFolder) return;
    let current = dirname(absPath);
    const rootNorm = normalizePath(selectedFolder);
    while (current && normalizePath(current).startsWith(rootNorm)) {
      const norm = normalizePath(current);
      if (norm === rootNorm) break;
      const isExpanded = expandedNodes[norm] === true;
      if (!isExpanded) {
        // If we know it's currently false, pass false to toggle to true
        const state = expandedNodes[norm];
        if (state === false) {
          toggleExpanded(norm, false);
        } else {
          toggleExpanded(norm); // undefined -> expand
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };

  // Open/close and derive query on input
  const lastCaretRef = useRef<number>(0);
  const scheduleCoords = useCallback((textarea: HTMLTextAreaElement, caret: number) => {
    // Defer layout reads until next frame to avoid forced reflow during input
    requestAnimationFrame(() => {
      const coords = getCursorCoordinates(textarea, caret);
      setAnchorPosition(coords);
    });
  }, [getCursorCoordinates]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (useLocalDraft) {
      setValueDraft(text);
    } else {
      onChange(text);
    }
    const caret = e.target.selectionStart ?? text.length;
    lastCaretRef.current = caret;
    const q = computeQueryFromValue(text, caret);
    if (q === null) {
      setOpen(false);
    } else {
      setQuery(q);
      // Calculate cursor position for dropdown placement (deferred)
      scheduleCoords(e.target, caret);
      setOpen(true);
      setActiveIndex(0);
    }
  }, [onChange, scheduleCoords, useLocalDraft]);

  const close = () => setOpen(false);

  const acceptSelection = (item: { abs: string; rel: string }) => {
    const el = textareaRef.current;
    const text = value;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const match = before.match(/@(\S*)$/);
    if (!match || match.index === undefined) return;
    const start = match.index;
    // Wrap the relative path in backticks for inline code formatting
    const inserted = `\`${item.rel}\``;
    const newText = before.slice(0, start) + inserted + text.slice(caret);
    onChange(newText);
    onSelectFilePath(item.abs);
    ensureAncestorsExpanded(item.abs);
    // keep focus
    setTimeout(() => textareaRef.current?.focus(), 0);
    close();
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || results.length === 0) return;
    switch (e.key) {
    case 'Tab': {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      setActiveIndex((i) => (i + dir + results.length) % results.length);
    
    break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    
    break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    
    break;
    }
    case 'Enter': {
      e.preventDefault();
      acceptSelection(results[activeIndex]);
    
    break;
    }
    case 'Escape': {
      e.preventDefault();
      close();
    
    break;
    }
    // No default
    }
  }, [open, results, activeIndex]);

  // Clicking outside closes
  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Build live region message for screen readers
  const liveMessage = useMemo(() => {
    if (!open) return '';
    if (results.length === 0) return 'No suggestions';
    const current = results[activeIndex];
    return `${results.length} suggestions. ${current ? 'Highlighted ' + current.rel : ''}`;
  }, [open, results, activeIndex]);

  return (
    <div ref={containerRef} className="autocomplete-container main-content-area-input-container">
      {/* ARIA for autocomplete accessibility */}
      <div id={descIdRef.current} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(1px, 1px, 1px, 1px)' }}>
        Use Up and Down arrow keys to navigate suggestions, Enter to insert the selected path, and Escape to close the list.
      </div>
      <div id={liveIdRef.current} aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(1px, 1px, 1px, 1px)' }}>
        {liveMessage}
      </div>
      <textarea
        ref={textareaRef}
        className="user-instructions-input"
        placeholder="Enter your instructions here..."
        value={useLocalDraft ? valueDraft : value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? (listboxIdRef.current) : undefined}
        aria-activedescendant={open ? `${listboxIdRef.current}-item-${activeIndex}` : undefined}
        aria-describedby={descIdRef.current}
        onBlur={() => {
          // Ensure latest draft is synced when leaving the field
          if (useLocalDraft && valueDraft !== value) {
            onChange(valueDraft);
          }
        }}
      />
      {open && results.length > 0 && (
        <div
          className="autocomplete-dropdown"
          style={{
            left: anchorPosition.x,
            top: anchorPosition.y,
          }}
          id={listboxIdRef.current}
          role="listbox"
          aria-label="File suggestions. Use Up/Down to navigate, Enter to insert, Escape to close."
        >
          <div className="autocomplete-header">Files</div>
          {results.map((item, idx) => (
            <button
              key={item.abs}
              className={`autocomplete-item ${idx === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSelection(item);
              }}
              type="button"
              role="option"
              id={`${listboxIdRef.current}-item-${idx}`}
              aria-selected={idx === activeIndex}
              tabIndex={-1}
            >
              <span>{item.rel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});


interface ContentAreaProps {
  selectedFiles: SelectedFileReference[];
  allFiles: FileData[];
  toggleFileSelection: (filePath: string) => void;
  toggleSelection: (filePath: string, lineRange?: LineRange) => void;
  openFolder: () => void;
  onViewFile: (filePath: string) => void;
  processingStatus: {
    status: "idle" | "processing" | "complete" | "error";
    message: string;
  };
  selectedSystemPrompts: SystemPrompt[];
  toggleSystemPromptSelection: (prompt: SystemPrompt) => void;
  onViewSystemPrompt?: (prompt: SystemPrompt) => void;
  selectedRolePrompts: RolePrompt[];
  toggleRolePromptSelection: (prompt: RolePrompt) => void;
  onViewRolePrompt?: (prompt: RolePrompt) => void;
  selectedInstructions: Instruction[];
  toggleInstructionSelection: (instruction: Instruction) => void;
  onViewInstruction?: (instruction: Instruction) => void;
  // Folder selection cache for UI aggregation in selected files view
  folderSelectionCache?: import('../types/file-types').DirectorySelectionCache;
  sortOrder: string;
  handleSortChange: (newSort: string) => void;
  sortDropdownOpen: boolean;
  toggleSortDropdown: () => void;
  sortOptions: { value: string; label: string }[];
  getSelectedFilesContent: () => string;  // Legacy - kept for interface compatibility
  calculateTotalTokens: () => number;
  instructionsTokenCount: number;
  userInstructions: string;
  setUserInstructions: (instructions: string) => void;
  fileTreeTokens: number;
  systemPromptTokens: number;
  rolePromptTokens: number;
  instructionsTokens: number;
  setSystemPromptsModalOpen: (open: boolean) => void;
  setRolePromptsModalOpen: (open: boolean) => void;
  setInstructionsModalOpen: (open: boolean) => void;
  loadFileContent: (filePath: string) => Promise<void>;
  loadMultipleFileContents: (filePaths: string[], options?: { priority?: number }) => Promise<void>;
  clipboardPreviewModalOpen: boolean;
  toggleFolderSelection?: (folderPath: string, isSelected: boolean, opts?: { optimistic?: boolean }) => void;
  previewContent: string;
  previewTokenCount: number;
  openClipboardPreviewModal: (content: string, tokenCount: number) => void;
  closeClipboardPreviewModal: () => void;
  selectedFolder: string | null;
  expandedNodes: Record<string, boolean>;
  toggleExpanded: (path: string, currentState?: boolean) => void;
  fileTreeMode: FileTreeMode;
  // New: clear all selections (files + prompts + docs)
  clearAllSelections?: () => void;
}


const ContentArea = ({
  selectedFiles,
  allFiles,
  toggleFileSelection,
  toggleSelection,
  openFolder,
  onViewFile,
  processingStatus,
  folderSelectionCache,
  selectedSystemPrompts,
  toggleSystemPromptSelection,
  onViewSystemPrompt,
  selectedRolePrompts,
  toggleRolePromptSelection,
  onViewRolePrompt,
  selectedInstructions,
  toggleInstructionSelection,
  onViewInstruction,
  sortOrder,
  handleSortChange,
  sortOptions,
  getSelectedFilesContent: _getSelectedFilesContent,  // Kept for interface compatibility
  calculateTotalTokens,
  instructionsTokenCount,
  userInstructions,
  setUserInstructions,
  fileTreeTokens,
  systemPromptTokens,
  rolePromptTokens,
  instructionsTokens,
  setSystemPromptsModalOpen,
  setRolePromptsModalOpen,
  setInstructionsModalOpen,
  loadFileContent,
  loadMultipleFileContents,
  clipboardPreviewModalOpen,
  previewContent,
  toggleFolderSelection,
  previewTokenCount,
  openClipboardPreviewModal,
  closeClipboardPreviewModal,
  selectedFolder,
  expandedNodes,
  toggleExpanded,
  fileTreeMode,
  clearAllSelections,
}: ContentAreaProps) => {
  const onClearAll = clearAllSelections || (() => {});


  const features = (window as any).__PF_FEATURES ?? FEATURES;

  const { 
    pack, 
    cancelPack, 
    packState, 
    previewState: streamingPreview, 
    pushFileUpdates,
    pushFileStatus
  } = usePreviewPack({
    allFiles,
    selectedFiles,
    sortOrder,
    selectedFolder,
    selectedSystemPrompts,
    selectedRolePrompts,
    selectedInstructions,
    userInstructions,
    fileTreeMode,
  });

  // Track which files have already been pushed to the worker to avoid duplicates
  const lastPushedRef = useRef<Set<string>>(new Set());
  const reportedErrorsRef = useRef<Set<string>>(new Set());

  // --- Minimal CLI bridge integration (Plan A) ---
  // Listen for CLI pack start/cancel events and invoke existing pipeline
  useEffect(() => {
    const onCliPackRequest = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as { id?: string; options?: { includeTrees?: boolean; maxFiles?: number; maxBytes?: number; prompt?: string } } | undefined;
        const opts = detail?.options || {};
        const overrides: { overrideUserInstructions?: string; overrideFileTreeMode?: FileTreeMode; maxFiles?: number; maxBytes?: number } = {};
        if (typeof opts.prompt === 'string') overrides.overrideUserInstructions = opts.prompt;
        if (typeof opts.includeTrees === 'boolean' && opts.includeTrees === true) {
          overrides.overrideFileTreeMode = 'selected-with-roots';
        }
        if (typeof opts.maxFiles === 'number') overrides.maxFiles = Math.max(0, Math.floor(opts.maxFiles));
        if (typeof opts.maxBytes === 'number') overrides.maxBytes = Math.max(0, Math.floor(opts.maxBytes));
        pack(overrides);
      } catch { /* ignore */ }
    };
    const onCliPackCancel = (_e: Event) => {
      try { cancelPack(); } catch { /* ignore */ }
    };
    window.addEventListener('pf-cli-pack-request', onCliPackRequest as EventListener);
    window.addEventListener('pf-cli-pack-cancel', onCliPackCancel as EventListener);
    return () => {
      window.removeEventListener('pf-cli-pack-request', onCliPackRequest as EventListener);
      window.removeEventListener('pf-cli-pack-cancel', onCliPackCancel as EventListener);
    };
  }, [pack, cancelPack]);

  // Emit pf-pack-state events for bridge to translate into ipc status/content
  useEffect(() => {
    const st = packState;
    if (!st) return;
    const detail = {
      status: st.status,
      processed: st.processed,
      total: st.total,
      percent: st.percent,
      tokenEstimate: st.tokenEstimate,
      fullContent: st.fullContent,
      contentForDisplay: st.contentForDisplay,
    };
    window.dispatchEvent(new CustomEvent('pf-pack-state', { detail }));
  }, [packState]);

  // Emit minimal lifecycle events for bridge to forward to main
  const lastEmittedStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = packState?.status;
    if (!status) return;

    // Avoid repeated emissions for the same terminal state
    if (status === lastEmittedStatusRef.current && (status === 'ready' || status === 'error' || status === 'cancelled')) {
      return;
    }

    if (status === 'ready') {
      window.dispatchEvent(new CustomEvent('pf-pack-ready', { detail: { fullContent: packState.fullContent || '', total: packState.total } }));
    } else if (status === 'error') {
      window.dispatchEvent(new CustomEvent('pf-pack-error', { detail: { message: packState.error || 'Unknown error' } }));
    } else if (status === 'cancelled') {
      window.dispatchEvent(new Event('pf-pack-cancelled'));
    }
    lastEmittedStatusRef.current = status;
  }, [packState?.status, packState?.fullContent, packState?.total, packState?.error]);

  // Memoize header file stats to avoid recomputing during streaming UI updates
  const headerFileStats = useMemo(() => {
    // Count all content items
    const fileCount = selectedFiles.length;
    const promptCount = selectedSystemPrompts.length + selectedRolePrompts.length;
    const docCount = selectedInstructions.length;
    const totalItems = fileCount + promptCount + docCount;

    // Calculate total tokens including all sources - using Map for O(1) lookups
    const sizeByPath = new Map(
      allFiles
        .filter(f => !f.isDirectory && !f.isBinary && !f.isSkipped)
        .map(f => [f.path, f.size ?? 0])
    );
    const totalSize = selectedFiles.reduce((sum, s) => sum + (sizeByPath.get(s.path) ?? 0), 0);
    const filesTokens = Math.round(totalSize / TOKEN_COUNTING.CHARS_PER_TOKEN);

    const totalEstimatedTokens = filesTokens + systemPromptTokens + rolePromptTokens + instructionsTokens;

    return `${totalItems} items | ~${totalEstimatedTokens.toLocaleString()} tokens (estimated)`;
  }, [
    selectedFiles,
    selectedSystemPrompts.length,
    selectedRolePrompts.length,
    selectedInstructions.length,
    allFiles,
    systemPromptTokens,
    rolePromptTokens,
    instructionsTokens
  ]);

  // Memoize token count display computation to prevent per-frame recomputation
  const memoTokenCount = useMemo(() => {
    let total = calculateTotalTokens();
    total += fileTreeTokens + systemPromptTokens + rolePromptTokens + instructionsTokens;
    if (userInstructions.trim()) {
      total += instructionsTokenCount;
    }
    return total;
  }, [
    calculateTotalTokens,
    fileTreeTokens,
    systemPromptTokens,
    rolePromptTokens,
    instructionsTokens,
    userInstructions,
    instructionsTokenCount
  ]);

  // Push newly loaded file contents to the worker so it can stream them
  useEffect(() => {
    if (!features?.PREVIEW_WORKER_ENABLED) return;

    // Feed the worker during packing or when ready (for updates)
    const shouldFeedWorker = packState?.status === 'packing' || packState?.status === 'ready';
    
    if (!shouldFeedWorker) {
      return; // The separate effect handles clearing
    }

    const map = new Map(allFiles.map(f => [f.path, f]));
    const updates: { path: string; content: string; tokenCount?: number }[] = [];

    for (const sel of selectedFiles) {
      const fd = map.get(sel.path);
      if (!fd) continue;
      if (fd.isContentLoaded && typeof fd.content === 'string' && !lastPushedRef.current.has(fd.path)) {
        updates.push({ path: fd.path, content: fd.content, tokenCount: fd.tokenCount });
      }
    }

    if (updates.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < updates.length; i += BATCH) {
        const slice = updates.slice(i, i + BATCH);
        setTimeout(() => pushFileUpdates(slice), 0);
      }
      for (const u of updates) lastPushedRef.current.add(u.path);
    }
  }, [allFiles, selectedFiles, packState?.status, pushFileUpdates, features?.PREVIEW_WORKER_ENABLED]);

  // Background progressive file loader for streaming preview
  // Loads not-yet-loaded selected files in small batches without blocking UI.
  useEffect(() => {
    if (!features?.PREVIEW_WORKER_ENABLED) return;
    
    // Load files during packing
    const shouldLoadFiles = packState?.status === 'packing';
    
    if (!shouldLoadFiles) return;

    // Build quick lookup for file metadata
    const byPath = new Map(allFiles.map(f => [f.path, f]));
    const { pending, errorFiles } = collectPendingAndErrors(selectedFiles, byPath);
    // Send error status for files that have terminal errors
    reportErrors(errorFiles, byPath, reportedErrorsRef.current, pushFileStatus);

    if (pending.length === 0) return;

    let cancelled = false;

    // Adaptive loader pacing for many selected files
    const { batch: BATCH, delayMs: STEP_DELAY_MS } = getBatchConfig(selectedFiles.length);

    const step = async () => {
      if (cancelled) return;
      const slice = pending.splice(0, BATCH);
      if (slice.length === 0) return;

      try {
        // Load this batch using batched loading for better performance
        await loadMultipleFileContents(slice, { priority: 10 });
        // Report any files with errors to the worker
        reportErrors(slice, byPath, reportedErrorsRef.current, pushFileStatus);
      } catch (error) {
        // Log the error for debugging but continue processing
        logger.debug('[Progressive loader] Batch load failed', {
          batchSize: slice.length,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Report any files with errors to the worker
        reportErrors(slice, byPath, reportedErrorsRef.current, pushFileStatus);
      }

      if (pending.length > 0 && !cancelled) {
        setTimeout(step, STEP_DELAY_MS);
      }
    };

    // Kick off after a short delay to ensure modal has painted
    const t = setTimeout(step, STEP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [allFiles, selectedFiles, packState?.status, loadMultipleFileContents, pushFileStatus, features?.PREVIEW_WORKER_ENABLED]);

  // Clear lastPushedRef and reportedErrorsRef when pack starts or when idle/error/cancelled/ready
  useEffect(() => {
    const shouldClear =
      packState?.status === 'packing' ||
      packState?.status === 'idle' ||
      packState?.status === 'error' ||
      packState?.status === 'cancelled' ||
      packState?.status === 'ready';
    if (!shouldClear) return;
    // Clear when starting or when not actively packing/complete to prevent memory leak
    lastPushedRef.current.clear();
    reportedErrorsRef.current.clear();
  }, [packState?.status]);

  // Periodic housekeeping during long packing sessions to prevent unbounded growth of tracking sets.
  // Trims oldest entries when size exceeds UI.PREVIEW.MAX_TRACKED_PATHS.
  useEffect(() => {
    if (packState?.status !== 'packing') return;

    const trimSet = (s: Set<string>) => {
      const max = UI.PREVIEW?.MAX_TRACKED_PATHS ?? 0;
      if (!max || s.size <= max) return;
      let excess = s.size - max;
      for (const v of s) {
        s.delete(v);
        if (--excess <= 0) break;
      }
    };

    const interval = window.setInterval(() => {
      trimSet(lastPushedRef.current);
      trimSet(reportedErrorsRef.current);
    }, UI.PREVIEW?.CLEANUP_INTERVAL_MS ?? 30_000);

    return () => window.clearInterval(interval);
  }, [packState?.status]);



  const handleCopyFromPreview = async () => {
    try {
      // Prioritize packState content when in ready state
      const getText = () => {
        if (packState.status === 'ready' && packState.fullContent) {
          return packState.fullContent;
        }
        // Fallback to streaming preview or modal content
        return streamingPreview?.fullContent || previewContent || '';
      };
      const isPlaceholder = (t: string) => /\[Content is loading\.{3}]/.test(t);

      // Backoff to avoid copying placeholders when preview just started
      let textToCopy = getText();
      for (let attempt = 0; attempt < UI.MODAL.BACKOFF_MAX_ATTEMPTS; attempt++) {
        if (textToCopy && !isPlaceholder(textToCopy)) {
          break;
        }
        if (attempt < UI.MODAL.BACKOFF_MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, UI.MODAL.BACKOFF_DELAY_MS));
          textToCopy = getText();
        }
      }

      const nav: any = navigator as any;
      await nav.clipboard?.writeText(textToCopy);
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error);
      // Modern browsers should support clipboard API, but show alert if it fails
      alert('Failed to copy to clipboard. Please try selecting and copying the text manually.');
    }
  };

  return (
    <div className="content-area">
      <div className="selected-files-content-area">
        <div className="selected-files-content-header">
          <div className="content-actions">
            <Dropdown
              options={sortOptions.map(option => ({
                value: option.value,
                label: option.label
              }))}
              value={sortOrder}
              onChange={handleSortChange}
              buttonLabel="Sort"
              buttonIcon={<ChevronDown size={16} />}
              containerClassName="sort-dropdown sort-dropdown-selected-files"
              buttonClassName="sort-dropdown-button"
              menuClassName="sort-options"
              itemClassName="sort-option"
              activeItemClassName="active"
            />
            <div className="file-stats">
             {headerFileStats}
           </div>
          </div>
          <div className="prompts-buttons-container">
            <button
              className="clear-all-button"
              onClick={onClearAll}
              title="Clear all selections"
            >
              <Eraser size={16} />
              <span>Clear All</span>
            </button>
            <button
              className="system-prompts-button"
              onClick={() => setSystemPromptsModalOpen(true)}
            >
              <Settings size={16} />
              <span>System Prompts</span>
              {selectedSystemPrompts.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedSystemPrompts.length}</span>
              )}
            </button>

            <button
              className="role-prompts-button"
              onClick={() => setRolePromptsModalOpen(true)}
            >
              <User size={16} />
              <span>Role Prompts</span>
              {selectedRolePrompts.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedRolePrompts.length}</span>
              )}
            </button>

            <button
              className="docs-button"
              onClick={() => setInstructionsModalOpen(true)}
            >
              <FileText size={16} />
              <span>Docs</span>
              {selectedInstructions.length > 0 && (
                <span className="selected-prompt-indicator"><Check size={12} /> {selectedInstructions.length}</span>
              )}
            </button>
          </div>
        </div>

        <FileList
          files={allFiles}
          selectedFiles={selectedFiles}
          toggleFileSelection={toggleFileSelection}
          toggleSelection={toggleSelection}
          openFolder={openFolder}
          onViewFile={onViewFile}
          processingStatus={processingStatus}
          folderSelectionCache={folderSelectionCache}
          selectedSystemPrompts={selectedSystemPrompts}
          toggleSystemPromptSelection={toggleSystemPromptSelection}
          onViewSystemPrompt={onViewSystemPrompt}
          selectedRolePrompts={selectedRolePrompts}
          toggleRolePromptSelection={toggleRolePromptSelection}
          onViewRolePrompt={onViewRolePrompt}
          selectedInstructions={selectedInstructions}
          toggleInstructionSelection={toggleInstructionSelection}
          onViewInstruction={onViewInstruction}
          loadFileContent={loadFileContent}
          toggleFolderSelection={toggleFolderSelection}
        />
      </div>
      <div className="user-instructions-input-area">
        <div className="instructions-token-count">
          ~{instructionsTokenCount.toLocaleString()} tokens
        </div>
        <InstructionsTextareaWithPathAutocomplete
          allFiles={allFiles}
          selectedFolder={selectedFolder}
          expandedNodes={expandedNodes}
          toggleExpanded={toggleExpanded}
          value={userInstructions}
          onChange={setUserInstructions}
          onSelectFilePath={(path) => {
            // Also select the file
            toggleFileSelection(path);
          }}
        />
        <div className="copy-button-container">
          <div className="copy-button-group">
            {(() => {
              const hasPreviewableContent =
                selectedFiles.length > 0 ||
                selectedSystemPrompts.length > 0 ||
                selectedRolePrompts.length > 0 ||
                selectedInstructions.length > 0 ||
                userInstructions.trim().length > 0;
              
              if (!hasPreviewableContent) return null;
              
              // Idle state - show Pack button (or legacy Preview when feature disabled)
              if (packState.status === 'idle') {
                if (features?.PREVIEW_PACK_ENABLED) {
                  return (
                    <button
                      className="preview-button"
                      onClick={() => pack()}
                      disabled={!hasPreviewableContent}
                    >
                      <Eye size={16} />
                      <span>Pack</span>
                    </button>
                  );
                }
                // Legacy path: show Preview directly without packing
                return (
                  <button
                    className="preview-button"
                    onClick={() => {
                      const display = previewContent || _getSelectedFilesContent();
                      const tokens = memoTokenCount;
                      openClipboardPreviewModal(display, tokens);
                    }}
                    disabled={!hasPreviewableContent}
                  >
                    <Eye size={16} />
                    <span>Preview</span>
                  </button>
                );
              }
              
              // Packing state - show progress and Cancel
              if (packState.status === 'packing') {
                return (
                  <>
                    <button 
                      className="preview-button packing" 
                      disabled 
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={packState.total > 0 ? packState.percent : undefined}
                      aria-valuetext={packState.total > 0 
                        ? `Packing: ${packState.percent}% complete`
                        : 'Packing in progress'
                      }
                    >
                      <div 
                        className={`progress-fill ${packState.total === 0 ? 'indeterminate' : ''}`}
                        style={packState.total > 0 ? { insetInlineEnd: `${100 - packState.percent}%` } : undefined}
                        aria-hidden="true"
                      />
                      <Eye size={16} />
                      <span aria-live="polite">
                        {packState.total > 0 
                          ? `Packing… ${packState.processed}/${packState.total} (${packState.percent}%)`
                          : 'Packing…'
                        }
                      </span>
                    </button>
                    <button 
                      className="preview-button" 
                      onClick={cancelPack}
                      aria-label="Cancel packing"
                    >
                      Cancel
                    </button>
                  </>
                );
              }
              
              // Ready state - show Pack (as Packed or Repack), Preview and Copy
              if (packState.status === 'ready') {
                // Check if signature has changed (content is out of date)
                const contentOutdated = packState.hasSignatureChanged || false;
                
                return (
                  <>
                    <button
                      className="preview-button"
                      onClick={() => pack()}
                      disabled={!contentOutdated}
                      title={contentOutdated ? "Content has changed - click to update pack" : "Content is up to date"}
                    >
                      <Package size={16} />
                      <span>{contentOutdated ? 'Repack' : 'Packed'}</span>
                    </button>
                    <button
                      className="preview-button"
                      onClick={() => {
                        // When ready, pass the packed content directly to the modal
                        // The modal will receive this via the content and tokenCount props
                        const display = packState.contentForDisplay || packState.fullContent?.slice(0, UI.PREVIEW.DISPLAY_CONTENT_MAX_LENGTH) || '';
                        const tokens = packState.tokenEstimate || 0;
                        openClipboardPreviewModal(display, tokens);
                      }}
                      title={contentOutdated ? "Preview (outdated content)" : "Preview packed content"}
                    >
                      <Eye size={16} />
                      <span>Preview</span>
                    </button>
                    <SendToAgentButton
                      status={packState.status}
                      selectedFolder={selectedFolder}
                      selectedFiles={selectedFiles}
                      selectedSystemPrompts={selectedSystemPrompts}
                      selectedRolePrompts={selectedRolePrompts}
                      selectedInstructions={selectedInstructions}
                      userInstructions={userInstructions}
                      tokenEstimate={packState.tokenEstimate}
                      signature={packState.signature}
                      fullContent={packState.fullContent}
                      contentForDisplay={packState.contentForDisplay}
                    />
                    <CopyButton
                      text={() => packState.fullContent || streamingPreview?.fullContent || ''}
                      className="primary copy-selected-files-btn"
                    >
                      <span>Copy</span>
                    </CopyButton>
                  </>
                );
              }
              
              // Error or cancelled state - show Retry Pack
              if (packState.status === 'error' || packState.status === 'cancelled') {
                return (
                  <button
                    className="preview-button"
                    onClick={() => pack()}
                    disabled={!hasPreviewableContent}
                  >
                    <Eye size={16} />
                    <span>Retry Pack</span>
                  </button>
                );
              }
              
              return null;
            })()}
          </div>
          <div className="token-count-display">
            ~{memoTokenCount.toLocaleString()} tokens (loaded files only)
            {/* Show recalculating indicator when packing or streaming */}
            {(() => {
              const isRecalculating = packState.status === 'packing' || 
                (streamingPreview && (streamingPreview.status === 'loading' || streamingPreview.status === 'streaming'));
              
              if (!isRecalculating) return null;
              
              return (
              <span 
                className="token-recalculating-indicator"
                aria-label="Recalculating token count"
              >
                <span className="recalc-dot recalc-dot-1" aria-hidden="true" />
                <span className="recalc-dot recalc-dot-2" aria-hidden="true" />
                <span className="recalc-dot recalc-dot-3" aria-hidden="true" />
              </span>
              );
            })()}
          </div>
        </div>
      </div>


      <ClipboardPreviewModal
        isOpen={clipboardPreviewModalOpen}
        onClose={closeClipboardPreviewModal}
        content={previewContent}
        tokenCount={previewTokenCount}
        onCopy={handleCopyFromPreview}
        previewState={(features?.PREVIEW_WORKER_ENABLED && packState.status === 'packing') ? streamingPreview : undefined}
        onCancel={features?.PREVIEW_WORKER_ENABLED ? cancelPack : undefined}
      />
    </div>
  );
};

export default memo(ContentArea);
