import {
  buildTokenCountsForSelectedFiles,
  dedupeSelectedFiles,
  buildWorkspaceState,
  reconcileSelectedInstructions,
} from "../hooks/use-app-state-helpers";
import type { FileData, SelectedFileReference, Instruction } from "../types/file-types";

const makeFile = (overrides: Partial<FileData> = {}): FileData => ({
  name: overrides.name ?? "a.ts",
  path: overrides.path ?? "/a.ts",
  isDirectory: overrides.isDirectory ?? false,
  size: overrides.size ?? 10,
  isBinary: overrides.isBinary ?? false,
  isSkipped: overrides.isSkipped ?? false,
  tokenCount: overrides.tokenCount ?? 3,
  content: overrides.content,
});

describe("use-app-state helpers", () => {
  it("dedupeSelectedFiles removes duplicate paths", () => {
    const input: SelectedFileReference[] = [
      { path: "/a.ts" },
      { path: "/b.ts" },
      { path: "/a.ts", lines: [{ start: 1, end: 2 }] },
    ];
    const result = dedupeSelectedFiles(input);
    expect(result.map((f) => f.path)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("buildTokenCountsForSelectedFiles maps token counts from allFiles", () => {
    const allFiles = [makeFile({ path: "/a.ts", tokenCount: 10 }), makeFile({ path: "/b.ts", tokenCount: 5 })];
    const selected: SelectedFileReference[] = [{ path: "/a.ts" }, { path: "/b.ts" }, { path: "/c.ts" }];
    const counts = buildTokenCountsForSelectedFiles(allFiles, selected);
    expect(counts).toEqual({ "/a.ts": 10, "/b.ts": 5, "/c.ts": 0 });
  });

  it("buildWorkspaceState assembles a normalized snapshot", () => {
    const state = buildWorkspaceState({
      selectedFolder: "/root",
      expandedNodes: { "/root": true },
      allFiles: [makeFile({ path: "/a.ts", tokenCount: 7 })],
      selectedFiles: [{ path: "/a.ts" }, { path: "/a.ts" }],
      sortOrder: "tokens-desc",
      searchTerm: "",
      fileTreeMode: "none",
      exclusionPatterns: [],
      userInstructions: "",
      systemPrompts: [],
      rolePrompts: [],
      selectedInstructions: [],
    });
    expect(state.selectedFiles).toHaveLength(1);
    expect(state.tokenCounts["/a.ts"]).toBe(7);
  });

  it("reconcileSelectedInstructions prefers current DB entries by id", () => {
    const saved: Instruction[] = [
      { id: "1", name: "Old", content: "old" },
      { id: "2", name: "OnlySaved", content: "saved" },
    ];
    const current: Instruction[] = [
      { id: "1", name: "New", content: "new" },
    ];
    const reconciled = reconcileSelectedInstructions(saved, current);
    expect(reconciled.find((i) => i.id === "1")?.name).toBe("New");
    expect(reconciled.find((i) => i.id === "2")?.name).toBe("OnlySaved");
  });
});

