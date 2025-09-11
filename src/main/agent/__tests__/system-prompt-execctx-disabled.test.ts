import { composeEffectiveSystemPrompt } from "../../agent/system-prompt";

describe("System prompt respects execution context toggle", () => {
  test("disables System Execution Context when preference is false", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === 'agent.executionContext.enabled') return false;
        if (k === 'agent.systemPrompt.mode') return 'default';
        if (k === 'agent.systemPrompt.text') return '';
        if (k === 'workspace.active') return null;
        return undefined;
      }
    } as { getPreference: (k: string) => Promise<unknown> };

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
    expect(sys).not.toMatch(/System Execution Context:/);
    expect(sys.trim().length).toBe(0);
  });
});
