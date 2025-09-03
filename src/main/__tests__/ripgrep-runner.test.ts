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

  it("parses JSON lines split across chunks", async () => {
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

    const p = run({ query: "TODO", maxResults: 10 });

    // Create a single JSON line and split it across two chunks mid-string
    const full = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/repo/src/split.ts" },
        line_number: 42,
        lines: { text: "// TODO: split across chunks" },
        submatches: [{ start: 3, end: 7 }],
      },
    });
    const cut = Math.floor(full.length / 2);
    const part1 = full.slice(0, cut);
    const part2 = full.slice(cut) + "\n";

    stdoutHandlers.forEach((fn) => fn(Buffer.from(part1)));
    stdoutHandlers.forEach((fn) => fn(Buffer.from(part2)));
    (events["close"] || []).forEach((fn) => fn());

    const out = await p;
    expect(out.totalMatches).toBe(1);
    expect(out.files[0].path).toContain("split.ts");
    expect(out.files[0].matches[0].line).toBe(42);
  });

  it("allows searches in a secondary workspace root", async () => {
    jest.resetModules();
    const roots = ["/rootA", "/rootB"];

    // Mock workspace in the module that ripgrep.ts will import
    jest.doMock("../../main/workspace-context", () => ({
      getAllowedWorkspacePaths: () => roots,
    }));

    const events: Record<string, Function[]> = {};
    const mockChild: any = {
      stdout: { on: () => {} },
      on: (ev: string, fn: Function) => { (events[ev] = events[ev] || []).push(fn); },
      kill: jest.fn(),
    };

    const spawn = jest.fn(() => {
      // immediately close so the promise resolves
      setTimeout(() => { (events["close"] || []).forEach((fn) => fn()); }, 0);
      return mockChild;
    });
    jest.doMock("node:child_process", () => ({ spawn }));

    const { runRipgrepJson: run } = await import("../../main/tools/ripgrep");
    await run({ query: "x", directory: "/rootB" }).catch(() => {});

    expect(spawn).toHaveBeenCalled();
    const call = spawn.mock.calls[0] as unknown as [string, string[], any];
    const args = call[1];
    // last arg is the chosen cwd passed to ripgrep
    expect(args[args.length - 1]).toBe("/rootB");
  });

  it("includes .gitignore at workspace root", async () => {
    jest.resetModules();

    jest.doMock("../../main/workspace-context", () => ({
      getAllowedWorkspacePaths: () => ["/repo"],
    }));

    const events: Record<string, Function[]> = {};
    const mockChild: any = {
      stdout: { on: () => {} },
      on: (ev: string, fn: Function) => { (events[ev] = events[ev] || []).push(fn); },
      kill: jest.fn(),
    };

    const spawn = jest.fn(() => {
      setTimeout(() => { (events["close"] || []).forEach((fn) => fn()); }, 0);
      return mockChild;
    });
    jest.doMock("node:child_process", () => ({ spawn }));

    // Mock fs.existsSync for .gitignore discovery
    jest.doMock("node:fs", () => {
      const existsSync = (p: any) => p === "/repo/.gitignore";
      return { __esModule: true, default: { existsSync }, existsSync };
    });

    const { runRipgrepJson: run } = await import("../../main/tools/ripgrep");
    await run({ query: "x", directory: "/repo" }).catch(() => {});

    expect(spawn).toHaveBeenCalled();
    const call = spawn.mock.calls[0] as unknown as [string, string[], any];
    const args = call[1];
    const idx = args.indexOf("--ignore-file");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/repo/.gitignore");
  });
});
