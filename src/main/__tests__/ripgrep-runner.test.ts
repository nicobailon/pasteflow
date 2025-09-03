import { runRipgrepJson } from "../../main/tools/ripgrep";
import * as workspace from "../../main/workspace-context";

describe("runRipgrepJson", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(workspace, "getAllowedWorkspacePaths").mockReturnValue(["/repo"]);
  });

  it("aggregates JSON lines into files/matches", async () => {
    // Mock spawn to emit two match lines then close
    const events: Record<string, Function[]> = {};
    const stdoutHandlers: Function[] = [];

    const mockChild: any = {
      stdout: { on: (_: string, fn: Function) => stdoutHandlers.push(fn) },
      on: (ev: string, fn: Function) => {
        (events[ev] = events[ev] || []).push(fn);
      },
      kill: jest.fn(),
    };

    jest.doMock("node:child_process", () => ({
      spawn: () => mockChild,
    }));

    const { runRipgrepJson: run } = await import("../../main/tools/ripgrep");

    const p = run({ query: "TODO", maxResults: 10 });

    const line1 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/repo/src/a.ts" },
        line_number: 5,
        lines: { text: "const x = 1; // TODO" },
        submatches: [{ start: 16, end: 20 }],
      },
    });
    const line2 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/repo/src/b.ts" },
        line_number: 3,
        lines: { text: "// TODO: refactor" },
        submatches: [{ start: 3, end: 7 }],
      },
    });

    // Emit stdout data and then close
    stdoutHandlers.forEach((fn) => fn(Buffer.from(line1 + "\n" + line2 + "\n")));
    (events["close"] || []).forEach((fn) => fn());

    const out = await p;
    expect(out.totalMatches).toBe(2);
    expect(out.files.length).toBe(2);
    const a = out.files.find((f: any) => f.path.endsWith("a.ts"));
    expect(a?.matches[0].line).toBe(5);
  });

  it("returns helpful error when rg not found", async () => {
    jest.resetModules();
    jest.spyOn(workspace, "getAllowedWorkspacePaths").mockReturnValue(["/repo"]);

    const mockChild: any = {
      stdout: { on: () => {} },
      on: (ev: string, fn: Function) => {
        if (ev === "error") {
          const err: any = new Error("spawn rg ENOENT");
          err.code = "ENOENT";
          setTimeout(() => fn(err), 0);
        }
      },
      kill: jest.fn(),
    };

    jest.doMock("node:child_process", () => ({
      spawn: () => mockChild,
    }));

    const { runRipgrepJson: run } = await import("../../main/tools/ripgrep");

    await expect(run({ query: "x" })).rejects.toThrow(/ripgrep not found/i);
  });

  it("sets truncated when caps are hit", async () => {
    jest.resetModules();
    jest.spyOn(workspace, "getAllowedWorkspacePaths").mockReturnValue(["/repo"]);

    const events: Record<string, Function[]> = {};
    const stdoutHandlers: Function[] = [];
    const mockChild: any = {
      stdout: { on: (_: string, fn: Function) => stdoutHandlers.push(fn) },
      on: (ev: string, fn: Function) => { (events[ev] = events[ev] || []).push(fn); },
      kill: jest.fn(),
    };

    jest.doMock("node:child_process", () => ({ spawn: () => mockChild }));
    const { runRipgrepJson: run } = await import("../../main/tools/ripgrep");

    const p = run({ query: "TODO", maxResults: 1 });

    const line1 = JSON.stringify({
      type: "match",
      data: { path: { text: "/repo/a.ts" }, line_number: 1, lines: { text: "a" }, submatches: [] },
    });
    const line2 = JSON.stringify({
      type: "match",
      data: { path: { text: "/repo/b.ts" }, line_number: 2, lines: { text: "b" }, submatches: [] },
    });
    stdoutHandlers.forEach((fn) => fn(Buffer.from(line1 + "\n" + line2 + "\n")));
    (events["close"] || []).forEach((fn) => fn());

    const out = await p;
    expect(out.totalMatches).toBeGreaterThanOrEqual(1);
    expect(out.truncated).toBe(true);
  });
});
