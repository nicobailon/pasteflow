import {
  appendToBuffers,
  buildLightweightFilesForStart,
  computeNeedsFullTree,
  computePercent,
  sanitizeErrorMessage,
} from "../hooks/use-preview-generator-helpers";
import type { FileData, SelectedFileReference } from "../types/file-types";

describe("use-preview-generator helpers", () => {
  describe("computeNeedsFullTree", () => {
    it("returns true only for complete and selected-with-roots", () => {
      expect(computeNeedsFullTree("none")).toBe(false);
      expect(computeNeedsFullTree("selected")).toBe(false);
      expect(computeNeedsFullTree("selected-with-roots")).toBe(true);
      expect(computeNeedsFullTree("complete")).toBe(true);
    });
  });

  describe("buildLightweightFilesForStart", () => {
    const makeFile = (overrides: Partial<FileData>): FileData => ({
      name: overrides.name ?? "a.ts",
      path: overrides.path ?? "/a.ts",
      isDirectory: overrides.isDirectory ?? false,
      size: overrides.size ?? 100,
      isBinary: overrides.isBinary ?? false,
      isSkipped: overrides.isSkipped ?? false,
      error: overrides.error,
      fileType: overrides.fileType ?? "ts",
      isContentLoaded: overrides.isContentLoaded,
      tokenCount: overrides.tokenCount,
      children: overrides.children,
      content: overrides.content,
      mtimeMs: overrides.mtimeMs,
      excludedByDefault: overrides.excludedByDefault,
      isCountingTokens: overrides.isCountingTokens,
      tokenCountError: overrides.tokenCountError,
    });

    it("includes all files when mode requires full tree", () => {
      const allFiles: FileData[] = [
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ];
      const selected: SelectedFileReference[] = [{ path: "/a.ts" }];
      const result = buildLightweightFilesForStart(allFiles, selected, "complete");
      expect(result.map((f) => f.path)).toEqual(["/a.ts", "/b.ts"]);
      // Ensure no heavy fields leak
      expect((result as unknown as FileData[])[0].content).toBeUndefined();
    });

    it("filters to selected files when not full tree", () => {
      const allFiles: FileData[] = [
        makeFile({ path: "/a.ts", name: "a.ts" }),
        makeFile({ path: "/b.ts", name: "b.ts" }),
      ];
      const selected: SelectedFileReference[] = [{ path: "/b.ts" }];
      const result = buildLightweightFilesForStart(allFiles, selected, "selected");
      expect(result.map((f) => f.path)).toEqual(["/b.ts"]);
    });
  });

  describe("appendToBuffers", () => {
    it("appends and truncates display correctly", () => {
      const currentDisplay = "abc";
      const currentFull = "abc";
      const { display, full } = appendToBuffers(currentDisplay, currentFull, "XYZ", "XYZ", 5);
      expect(display).toBe("abcXY"); // truncated to 5
      expect(full).toBe("abcXYZ");  // full is not truncated
    });

    it("handles undefined parts safely", () => {
      const { display, full } = appendToBuffers("", "", undefined, undefined, 3);
      expect(display).toBe("");
      expect(full).toBe("");
    });
  });

  describe("computePercent", () => {
    it("guards against zero totals and clamps to [0,100]", () => {
      expect(computePercent(0, 0)).toBe(0);
      expect(computePercent(1, 0)).toBe(100);
      expect(computePercent(5, 10)).toBe(50);
      expect(computePercent(20, 10)).toBe(100);
      expect(computePercent(-5, 10)).toBe(0);
    });
  });

  describe("sanitizeErrorMessage", () => {
    it("normalizes whitespace and length", () => {
      const msg = sanitizeErrorMessage("  some\n\t error   message  ");
      expect(msg).toBe("some error message");
    });

    it("handles Error objects and non-strings", () => {
      expect(sanitizeErrorMessage(new Error("boom"))).toBe("boom");
      expect(sanitizeErrorMessage(42)).toBe("42");
      expect(sanitizeErrorMessage(undefined)).toMatch(/Unknown error/);
    });
  });
});

