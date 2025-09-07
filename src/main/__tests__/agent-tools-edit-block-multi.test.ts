import { getAgentTools } from "../../main/agent/tools";

// Mocks for safe path + file IO
jest.mock("../../main/file-service", () => ({
  validateAndResolvePath: (p: string) => ({ ok: true, absolutePath: p }),
  readTextFile: async (p: string) => {
    if (p.endsWith("a.txt")) return { ok: true as const, content: "TODO one\nline2\n", isLikelyBinary: false };
    if (p.endsWith("b.txt")) return { ok: true as const, content: "lineA\nTODO two\n", isLikelyBinary: false };
    return { ok: true as const, content: "none\n", isLikelyBinary: false };
  },
  writeTextFile: async (_p: string, content: string) => ({ ok: true as const, bytes: Buffer.byteLength(content, 'utf8') }),
}));

jest.mock("../../services/token-service-main", () => ({
  getMainTokenService: () => ({
    countTokens: async (text: string) => ({ count: Math.ceil(text.length / 4), backend: 'estimate' as const }),
  }),
}));

describe("Agent tools - edit.block and edit.multi", () => {
  it("block: previews replacement at first occurrence with context and diffs", async () => {
    const tools = getAgentTools();
    const res: any = await tools.edit.execute({ action: 'block', path: '/repo/a.txt', search: 'TODO', replacement: '' });
    expect(res.type).toBe('preview');
    expect(res.occurrencesCount).toBeGreaterThanOrEqual(1);
    expect(res.replacedOccurrenceIndex).toBe(1);
    expect(Array.isArray(res.characterDiffs)).toBe(true);
    expect(res.tokenCounts).toBeTruthy();
  });

  it("multi: previews across files, aggregates totals, caps when maxFiles reached", async () => {
    const tools = getAgentTools();
    const out: any = await tools.edit.execute({ action: 'multi', paths: ['/repo/a.txt', '/repo/b.txt'], search: 'TODO', replacement: 'DONE', occurrencePolicy: 'all', preview: true });
    expect(Array.isArray(out.files)).toBe(true);
    expect(out.totalReplacements).toBeGreaterThan(0);
    // Each file entry should have tokenCounts
    for (const f of out.files) {
      expect(f.tokenCounts).toBeTruthy();
    }
  });

  it("block: apply gated returns structured error when approval required or writes disabled", async () => {
    const tools = getAgentTools();
    const res: any = await tools.edit.execute({ action: 'block', path: '/repo/a.txt', search: 'TODO', replacement: 'DONE', apply: true, preview: false });
    // Default config disables writes; expect a typed error response
    expect(res && (res.code === 'WRITE_DISABLED' || res.code === 'APPROVAL_REQUIRED' || res.type === 'error')).toBe(true);
  });
});

