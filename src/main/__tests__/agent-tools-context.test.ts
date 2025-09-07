import { getAgentTools } from "../../main/agent/tools";

// Mock token counting to be deterministic and fast
jest.mock("../../services/token-service-main", () => ({
  getMainTokenService: () => ({
    countTokens: async (text: string) => ({ count: Math.ceil(text.length / 4), backend: "estimate" as const }),
  }),
}));

describe("Agent tools - context (summary|expand|search)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("summary counts initial/dynamic files and defaults when action omitted", async () => {
    const tools = getAgentTools();
    const envelope = { initial: { files: [1, 2, 3] }, dynamic: { files: [1] } } as const;

    const out1 = await tools.context.execute({ action: "summary", envelope });
    expect(out1.initialFiles).toBe(3);
    expect(out1.dynamicFiles).toBe(1);

    const out2 = await tools.context.execute({ envelope });
    expect(out2.initialFiles).toBe(3);
    expect(out2.dynamicFiles).toBe(1);
  });

  it("expand reads files, slices lines, caps bytes, and flags binaries", async () => {
    // Mock file-service safe path + reads
    jest.doMock("../../main/file-service", () => ({
      validateAndResolvePath: (p: string) => ({ ok: true as const, absolutePath: p }),
      readTextFile: async (p: string) => {
        if (p.endsWith("/repo/bin")) return { ok: true as const, content: "\u0000\u0001", isLikelyBinary: true };
        if (p.endsWith("/repo/small.txt")) return { ok: true as const, content: "a\nb\nc\n", isLikelyBinary: false };
        if (p.endsWith("/repo/long.txt")) return { ok: true as const, content: "x".repeat(10_000), isLikelyBinary: false };
        return { ok: true as const, content: "foo", isLikelyBinary: false };
      },
    }));

    const { getAgentTools: get } = await import("../../main/agent/tools");
    const tools = get();

    const res = await tools.context.execute({
      action: "expand",
      files: [
        { path: "/repo/small.txt", lines: { start: 2, end: 2 } }, // expect "b"
        { path: "/repo/bin" }, // expect error BINARY_FILE
        { path: "/repo/long.txt" }, // expect truncation with small maxBytes
      ],
      maxBytes: 10,
    });

    expect(Array.isArray(res.files)).toBe(true);
    const a = res.files[0];
    expect(a.path).toContain("/repo/small.txt");
    expect(a.content).toBe("b");
    expect(typeof a.tokenCount).toBe("number");

    const b = res.files[1];
    expect(b.error?.code).toBe("BINARY_FILE");

    const c = res.files[2];
    expect(c.truncated).toBe(true);

    // Over-cap list should set top-level truncated
    const many = await tools.context.execute({
      action: "expand",
      files: Array.from({ length: 25 }, (_, i) => ({ path: `/repo/m${i}.txt` })),
    });
    expect(many.truncated).toBe(true);
    expect(many.files.length).toBeLessThanOrEqual(20);
  });

  it("search delegates to ripgrep and compacts output; logs meta", async () => {
    const spy: { name: string; args: unknown; res: unknown; meta: any }[] = [];

    jest.doMock("../../main/tools/ripgrep", () => ({
      runRipgrepJson: async () => ({
        files: [
          { path: "/repo/a.ts", matches: [{ line: 1, text: "// TODO a", ranges: [] }] },
          { path: "/repo/b.ts", matches: [{ line: 2, text: "// TODO b", ranges: [] }] },
        ],
        totalMatches: 2,
        truncated: false,
      }),
    }));

    const { getAgentTools: get } = await import("../../main/agent/tools");
    const tools = get({
      onToolExecute: async (name, args, res, meta) => {
        spy.push({ name, args, res, meta });
      },
    });

    const out = await tools.context.execute({ action: "search", query: "TODO", directory: "/repo", maxResults: 10 });
    expect(out.totalMatches).toBe(2);
    expect(out.files.length).toBe(2);
    expect(out.files[0].matches[0].line).toBe(1);

    // Verify logging meta
    const log = spy.find((x) => x.name === "context");
    expect(log).toBeTruthy();
    expect(typeof log!.meta.startedAt).toBe("number");
    expect(typeof log!.meta.durationMs).toBe("number");
  });
});
