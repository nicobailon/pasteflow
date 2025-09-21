import { composeEffectiveSystemPrompt } from "../../agent/system-prompt";
import type { CombinedContext } from "../../agent/system-prompt";

describe("System prompt composition with global + workspace", () => {
  const baseCtx: CombinedContext = {
    dynamic: { files: [] },
    workspace: "/ws",
  };

  test("workspace replace takes precedence over global replace", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === "workspace.active") return "ws-1";
        if (k === "agent.systemPrompt.replace") return false;
        if (k === "agent.systemPrompt.text") return "GLOBAL_ONLY";
        if (k === "agent.systemPrompt.replace.ws-1") return true;
        if (k === "agent.systemPrompt.text.ws-1") return "WORKSPACE_ONLY";
        if (k === "agent.executionContext.enabled") return false; // keep output stable
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
      },
    } as { getPreference: (k: string) => Promise<unknown> };

    const out = await composeEffectiveSystemPrompt(db, baseCtx, { enabledTools: new Set() });
    const idxG = out.indexOf("GLOBAL_PREFIX");
    const idxW = out.indexOf("WORKSPACE_PREFIX");
    expect(idxG).toBeGreaterThanOrEqual(0);
    expect(idxW).toBeGreaterThan(idxG);
  });

  test("enabled tools guidance is appended and filtered", async () => {
    const db = {
      getPreference: async (k: string) => {
        if (k === "agent.executionContext.enabled") return false;
      },
    } as { getPreference: (k: string) => Promise<unknown> };

    const enabled = new Set(["file", "terminal"]);
    const out = await composeEffectiveSystemPrompt(db, baseCtx, { enabledTools: enabled });
    expect(out).toContain("Tool Guidance:");
    expect(out).toContain("file: Use file.read");
    expect(out).toContain("terminal: Use terminal.start");
    expect(out).not.toContain("search: Use search.code");
  });
});
