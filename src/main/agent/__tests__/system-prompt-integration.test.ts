import { composeEffectiveSystemPrompt } from "../../agent/system-prompt";

describe("System prompt includes execution context", () => {
  test("composeEffectiveSystemPrompt injects System Execution Context", async () => {
    const db = { getPreference: async (_k: string) => undefined } as { getPreference: (k: string) => Promise<unknown> };
    const ctx = {
      initial: {
        files: [],
        prompts: { system: [], roles: [], instructions: [] },
        user: { present: false, tokenCount: 0 },
        metadata: { totalTokens: 0 },
      },
      dynamic: { files: [] },
      workspace: "/ws",
    };

    const sys = await composeEffectiveSystemPrompt(db, ctx, { enabledTools: new Set() });
    expect(sys).toMatch(/System Execution Context:/);
    expect(sys).toMatch(/- Working Directory:/);
    expect(sys).toMatch(/- Platform:/);
  });
});

