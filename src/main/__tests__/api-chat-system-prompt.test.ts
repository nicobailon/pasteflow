import { buildSystemPrompt } from "../agent/system-prompt";

describe("buildSystemPrompt", () => {
  test("summarizes initial + dynamic file lists and prompts", () => {
    const sys = buildSystemPrompt({
      initial: {
        files: [ { path: "/ws/a.ts", relativePath: "a.ts", lines: null } ],
        prompts: { system: [{ id: 's1', name: 'Sys1' }], roles: [], instructions: [] },
        user: { present: true, tokenCount: 12 },
        metadata: { totalTokens: 100, signature: 'sig' },
      },
      dynamic: { files: [ { path: "/ws/b.ts", relativePath: "b.ts", lines: { start: 1, end: 2 } } ] },
      workspace: "/ws",
    });
    expect(sys).toMatch(/Workspace: \/ws/);
    expect(sys).toMatch(/Initial Context:/);
    expect(sys).toMatch(/a\.ts/);
    expect(sys).toMatch(/Dynamic Context:/);
    expect(sys).toMatch(/b\.ts/);
    expect(sys).toMatch(/Prompts Summary/);
  });
});

