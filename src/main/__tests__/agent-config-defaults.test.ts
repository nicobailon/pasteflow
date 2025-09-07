import { getEnvAgentConfig } from "../../main/agent/config";

describe("Agent config defaults", () => {
  it("returns sane defaults without prefs", () => {
    const cfg = getEnvAgentConfig();
    expect(typeof cfg.DEFAULT_MODEL).toBe("string");
    expect(cfg.MAX_CONTEXT_TOKENS).toBeGreaterThan(0);
    expect(typeof cfg.ENABLE_FILE_WRITE).toBe("boolean");
    expect(['never','risky','always']).toContain(cfg.APPROVAL_MODE);
  });
});
