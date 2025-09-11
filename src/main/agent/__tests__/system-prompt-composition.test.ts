import { composeEffectiveSystemPrompt } from "../../agent/system-prompt";

describe("System prompt composition with global + workspace", () => {
  const baseCtx = {
    initial: {
      files: [],
      prompts: { system: [], roles: [], instructions: [] },
      user: { present: false, tokenCount: 0 },
      metadata: { totalTokens: 0 },
    },
    dynamic: { files: [] },
    workspace: "/ws",
  } as const;

  test("workspace replace takes precedence over global replace", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === "workspace.active") return "ws-1";
        if (k === "agent.systemPrompt.replace") return false;
        if (k === "agent.systemPrompt.text") return "GLOBAL_ONLY";
        if (k === "agent.systemPrompt.replace.ws-1") return true;
        if (k === "agent.systemPrompt.text.ws-1") return "WORKSPACE_ONLY";
        if (k === "agent.executionContext.enabled") return false; // keep output stable
        return undefined;
      },
    } as { getPreference: (k: string) => Promise<unknown> };

    const out = await composeEffectiveSystemPrompt(db, baseCtx, { enabledTools: new Set() });
    expect(out.trim()).toBe("WORKSPACE_ONLY");
  });

  test("default order: global then workspace", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === "workspace.active") return "ws-1";
        if (k === "agent.systemPrompt.replace") return false;
        if (k === "agent.systemPrompt.text") return "GLOBAL_PREFIX";
        if (k === "agent.systemPrompt.replace.ws-1") return false;
        if (k === "agent.systemPrompt.text.ws-1") return "WORKSPACE_SUFFIX";
        if (k === "agent.executionContext.enabled") return false; // keep output stable
        return undefined;
      },
    } as { getPreference: (k: string) => Promise<unknown> };

    const out = await composeEffectiveSystemPrompt(db, baseCtx, { enabledTools: new Set() });
    const idxG = out.indexOf("GLOBAL_PREFIX");
    const idxW = out.indexOf("WORKSPACE_SUFFIX");
    expect(idxG).toBeGreaterThanOrEqual(0);
    expect(idxW).toBeGreaterThan(idxG);
  });

  test("no replace: both prompts included in order", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === "workspace.active") return "ws-1";
        if (k === "agent.systemPrompt.replace") return false;
        if (k === "agent.systemPrompt.text") return "GLOBAL_PREFIX";
        if (k === "agent.systemPrompt.replace.ws-1") return false;
        if (k === "agent.systemPrompt.text.ws-1") return "WORKSPACE_PREFIX";
        if (k === "agent.executionContext.enabled") return false; // keep output stable
        return undefined;
      },
    } as { getPreference: (k: string) => Promise<unknown> };

    const out = await composeEffectiveSystemPrompt(db, baseCtx, { enabledTools: new Set() });
    const idxG = out.indexOf("GLOBAL_PREFIX");
    const idxW = out.indexOf("WORKSPACE_PREFIX");
    expect(idxG).toBeGreaterThanOrEqual(0);
    expect(idxW).toBeGreaterThan(idxG);
  });
});
