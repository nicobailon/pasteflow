import { applySelectionChange, type SelectionAction } from "../hooks/use-file-selection-state";
import type { FileData, SelectedFileReference, LineRange } from "../types/file-types";
import { buildFolderIndex } from "../utils/folder-selection-index";

describe("applySelectionChange – pure transitions", () => {
  const files: FileData[] = [
    { name: "a.ts", path: "/p/a.ts", isDirectory: false, size: 1, isBinary: false, isSkipped: false },
    { name: "b.ts", path: "/p/b.ts", isDirectory: false, size: 1, isBinary: false, isSkipped: false },
    { name: "c.bin", path: "/p/c.bin", isDirectory: false, size: 1, isBinary: true, isSkipped: false },
    { name: "skipped.md", path: "/p/docs/skipped.md", isDirectory: false, size: 1, isBinary: false, isSkipped: true },
  ];
  const allFilesMap = new Map(files.map((f) => [f.path, f] as const));
  const folderIndex = buildFolderIndex(files);

  it("toggles a file on and off without duplicates", () => {
    let state: SelectedFileReference[] = [];
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/a.ts" }, { allFilesMap });
    expect(state).toEqual([{ path: "/p/a.ts" }]);
    // Toggle again removes
    const prev = state;
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/a.ts" }, { allFilesMap });
    expect(state).toEqual([]);
    // Ensure no accidental duplicates when re-adding
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/a.ts" }, { allFilesMap });
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/a.ts" }, { allFilesMap });
    expect(state).toEqual([]);
    // prev reference unchanged when no-op
    expect(
      applySelectionChange(prev, { type: "toggle-file", filePath: "/p/does-not-exist.ts" }, { allFilesMap })
    ).toBe(prev);
  });

  it("does not select binary or skipped files", () => {
    let state: SelectedFileReference[] = [];
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/c.bin" }, { allFilesMap });
    expect(state).toEqual([]);
    state = applySelectionChange(state, { type: "toggle-file", filePath: "/p/docs/skipped.md" }, { allFilesMap });
    expect(state).toEqual([]);
  });

  it("toggles a line range and removes file when last range is removed", () => {
    const r1: LineRange = { start: 1, end: 5 };
    const r2: LineRange = { start: 10, end: 12 };
    let state: SelectedFileReference[] = [];
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/a.ts", range: r1 }, { allFilesMap });
    expect(state).toEqual([{ path: "/p/a.ts", lines: [r1] }]);
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/a.ts", range: r2 }, { allFilesMap });
    expect(state).toEqual([{ path: "/p/a.ts", lines: [r1, r2] }]);
    // Remove r1
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/a.ts", range: r1 }, { allFilesMap });
    expect(state).toEqual([{ path: "/p/a.ts", lines: [r2] }]);
    // Remove r2 => file removed
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/a.ts", range: r2 }, { allFilesMap });
    expect(state).toEqual([]);
  });

  it("toggle-line-range without range toggles whole file", () => {
    let state: SelectedFileReference[] = [];
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/b.ts" }, { allFilesMap });
    expect(state).toEqual([{ path: "/p/b.ts" }]);
    state = applySelectionChange(state, { type: "toggle-line-range", filePath: "/p/b.ts" }, { allFilesMap });
    expect(state).toEqual([]);
  });

  it("select-all and deselect-all respect displayed files and filters", () => {
    let state: SelectedFileReference[] = [];
    state = applySelectionChange(state, { type: "select-all", displayedFiles: files }, { allFilesMap });
    // Should include only non-binary, non-skipped
    expect(state.map((s) => s.path).sort()).toEqual(["/p/a.ts", "/p/b.ts"].sort());
    state = applySelectionChange(state, { type: "deselect-all", displayedFiles: files }, { allFilesMap });
    expect(state).toEqual([]);
  });

  it("toggle-folder adds or removes only selectable files", () => {
    let state: SelectedFileReference[] = [];
    // Select folder /p
    state = applySelectionChange(state, { type: "toggle-folder", folderPath: "/p", isSelected: true }, { allFilesMap, folderIndex });
    expect(state.map((s) => s.path).sort()).toEqual(["/p/a.ts", "/p/b.ts"].sort());
    // Now deselect same folder
    state = applySelectionChange(state, { type: "toggle-folder", folderPath: "/p", isSelected: false }, { allFilesMap, folderIndex });
    expect(state).toEqual([]);
  });

  it("toggle-folder is a no-op when already in desired state", () => {
    const start: SelectedFileReference[] = [{ path: "/p/a.ts" }, { path: "/p/b.ts" }];
    const s1 = applySelectionChange(start, { type: "toggle-folder", folderPath: "/p", isSelected: true }, { allFilesMap, folderIndex });
    expect(s1).toBe(start); // identity to help memoization
    const s2 = applySelectionChange([], { type: "toggle-folder", folderPath: "/p", isSelected: false }, { allFilesMap, folderIndex });
    expect(s2).toEqual([]);
  });

  it("clear and set handle deduplication", () => {
    const setState = applySelectionChange([
      { path: "/p/a.ts" },
      { path: "/p/a.ts" },
    ], { type: "set", files: [
      { path: "/p/a.ts" },
      { path: "/p/b.ts" },
      { path: "/p/b.ts", lines: [{ start: 1, end: 2 }] },
    ] });
    // Last wins for same path; exact policy is to keep last occurrence
    expect(setState.find((f) => f.path === "/p/a.ts")).toBeTruthy();
    const allPaths = new Set(setState.map((f) => f.path));
    expect(allPaths.size).toBe(2);

    const cleared = applySelectionChange(setState, { type: "clear" });
    expect(cleared).toEqual([]);
  });
});

