import { getAgentTools } from "../../main/agent/tools";

// Mocks
jest.mock("../../main/file-service", () => ({
  validateAndResolvePath: (p: string) => ({ ok: true, absolutePath: p }),
  readTextFile: async (_p: string) => ({ ok: true, content: "line1\nline2", isLikelyBinary: false }),
}));

jest.mock("../../services/token-service-main", () => ({
  getMainTokenService: () => ({
    countTokens: async (text: string) => ({ count: Math.ceil(text.length / 4), backend: 'estimate' as const }),
  }),
}));

describe("Agent tools - file + edit", () => {
  it("file tool returns numeric tokenCount", async () => {
    const tools = getAgentTools();
    const res = await tools.file.execute({ path: "/repo/a.txt" });
    expect(typeof res.tokenCount).toBe("number");
    expect(res.path).toContain("/repo/a.txt");
  });

  it("edit.preview applies a simple unified diff and returns token counts", async () => {
    const tools = getAgentTools();
    const diff = [
      "@@ -1,2 +1,2 @@",
      " line1",
      "-line2",
      "+line2_mod",
    ].join("\n");

    const out = await tools.edit.execute({ path: "/repo/a.txt", diff, apply: false });
    expect(out.type).toBe("preview");
    expect(out.applied).toBe(true);
    expect(typeof out.tokenCounts.original).toBe("number");
    expect(typeof out.tokenCounts.modified).toBe("number");
    expect(String(out.modified)).toContain("line2_mod");
  });

  it("edit.preview returns error on context mismatch", async () => {
    const tools = getAgentTools();
    const badDiff = [
      "@@ -1,1 +1,1 @@",
      " wrongctx",
      "-line2",
      "+line2_mod",
    ].join("\n");

    const out = await tools.edit.execute({ path: "/repo/a.txt", diff: badDiff, apply: false });
    expect(out.type).toBe("preview");
    expect(out.applied).toBe(false);
    expect(String(out.error || "")).toContain("mismatch");
  });
});

