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
});

