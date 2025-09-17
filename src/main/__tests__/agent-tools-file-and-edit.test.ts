import { getAgentTools } from "../../main/agent/tools";
import { getEnvAgentConfig } from "../../main/agent/config";

// Mocks
jest.mock("../../main/file-service", () => {
  const memory = new Map<string, string>([["/repo/a.txt", "line1\nline2"]]);
  const statFor = (path: string) => {
    const content = memory.get(path);
    if (!content) {
      return { ok: false as const, code: 'FILE_NOT_FOUND' as const, message: 'File not found' };
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    return {
      ok: true as const,
      data: {
        name: path.split('/').pop() || path,
        path,
        size: bytes,
        isDirectory: false,
        isBinary: false,
        mtimeMs: Date.now(),
        fileType: null,
      },
    };
  };

  return {
    validateAndResolvePath: (p: string) => ({ ok: true as const, absolutePath: p }),
    readTextFile: async (p: string) => {
      const content = memory.get(p);
      if (!content) {
        return { ok: false as const, code: 'FILE_NOT_FOUND' as const, message: 'File not found' };
      }
      return { ok: true as const, content, isLikelyBinary: false };
    },
    writeTextFile: async (p: string, content: string) => {
      memory.set(p, content);
      return { ok: true as const, bytes: Buffer.byteLength(content, 'utf8') };
    },
    statFile: statFor,
    deletePath: async (p: string) => {
      const entry = memory.get(p);
      if (!entry) {
        return { ok: false as const, code: 'FILE_NOT_FOUND' as const, message: 'File not found' };
      }
      memory.delete(p);
      return { ok: true as const, removed: 'file' as const, bytes: Buffer.byteLength(entry, 'utf8') };
    },
    movePath: async (from: string, to: string) => {
      const entry = memory.get(from);
      if (!entry) {
        return { ok: false as const, code: 'FILE_NOT_FOUND' as const, message: 'Source file not found' };
      }
      if (memory.has(to) && to !== from) {
        return { ok: false as const, code: 'VALIDATION_ERROR' as const, message: 'Destination already exists' };
      }
      memory.delete(from);
      memory.set(to, entry);
      return { ok: true as const, bytes: Buffer.byteLength(entry, 'utf8') };
    },
    __getMemory: () => memory,
  };
});

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

  it("file.write previews new file and apply requires write permission", async () => {
    const tools = getAgentTools();
    const preview: any = await tools.file.execute({ action: 'write', path: '/repo/new-file.ts', content: 'export const x = 1;\n' });
    expect(preview.type).toBe('preview');
    expect(preview.exists).toBe(false);
    expect(preview.bytes).toBeGreaterThan(0);

    const applied: any = await tools.file.execute({ action: 'write', path: '/repo/new-file.ts', content: 'export const x = 1;\n', apply: true });
    expect(applied?.type).toBe('error');
    expect(applied?.code).toBe('WRITE_DISABLED');
  });

  it("file.write applies when writes enabled", async () => {
    const baseConfig = getEnvAgentConfig();
    const tools = getAgentTools({ config: { ...baseConfig, ENABLE_FILE_WRITE: true, APPROVAL_MODE: 'never' } });
    const applied: any = await tools.file.execute({ action: 'write', path: '/repo/new-file.ts', content: 'export const y = 2;\n', apply: true });
    expect(applied.type).toBe('applied');
    const fileService = jest.requireMock("../../main/file-service") as any;
    expect(fileService.__getMemory().get('/repo/new-file.ts')).toContain('export const y = 2');
  });

  it("edit.diff can create a brand new file when writes enabled", async () => {
    const baseConfig = getEnvAgentConfig();
    const tools = getAgentTools({ config: { ...baseConfig, ENABLE_FILE_WRITE: true, APPROVAL_MODE: 'never' } });
    const diff = [
      "@@ -0,0 +1,3 @@",
      "+export function Example() {",
      "+  return 'ok';",
      "+}",
    ].join("\n");

    const applied: any = await tools.edit.execute({ path: '/repo/new-component.ts', diff, apply: true });
    expect(applied.type).toBe('applied');
    const fileService = jest.requireMock("../../main/file-service") as any;
    const contents = fileService.__getMemory().get('/repo/new-component.ts');
    expect(contents).toContain("return 'ok'");
  });
});
