import { getAgentTools } from "../../main/agent/tools";

jest.mock("../../services/token-service-main", () => ({
  getMainTokenService: () => ({ countTokens: async (t: string) => ({ count: Math.ceil((t?.length || 0)/4) }) }),
}));

describe("generateFromTemplate tool", () => {
  it("returns files and tokenCount", async () => {
    const tools = getAgentTools();
    const res = await (tools as any).generateFromTemplate.execute({ type: 'component', name: 'SampleWidget' });
    expect(Array.isArray(res.files)).toBe(true);
    expect(res.files[0].path).toContain('src/components');
    expect(typeof res.tokenCount).toBe("number");
  });

  it("uses .test.tsx for component test templates", async () => {
    const tools = getAgentTools();
    const res = await (tools as any).generateFromTemplate.execute({ type: 'test', name: 'SampleWidget' });
    const file = res.files[0];
    expect(file.path.endsWith('src/__tests__/sample-widget.test.tsx')).toBe(true);
  });

  it("generates API route handler with valid identifier", async () => {
    const tools = getAgentTools();
    const res = await (tools as any).generateFromTemplate.execute({ type: 'api-route', name: 'sample-widget' });
    const file = res.files[0];
    expect(file.path.endsWith('src/main/routes/sample-widget.ts')).toBe(true);
    // Should contain a PascalCase handler name ending with Handler
    expect(file.content).toMatch(/export\s+async\s+function\s+SampleWidgetHandler\(/);
  });

  it("uses kebab-case import and .test.ts for hook tests", async () => {
    const tools = getAgentTools();
    const res = await (tools as any).generateFromTemplate.execute({ type: 'test', name: 'use-fancy-thing' });
    const file = res.files[0];
    expect(file.path.endsWith('src/hooks/__tests__/use-fancy-thing.test.ts')).toBe(true);
    expect(file.content).toContain("from \"../../hooks/use-fancy-thing\"");
  });
});
