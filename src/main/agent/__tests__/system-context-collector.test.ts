import { collectSystemExecutionContext } from "../../agent/system-context-collector";

describe("SystemContextCollector", () => {
  it("collects basic system information", async () => {
    const context = await collectSystemExecutionContext();
    expect(context.directory.cwd).toBeTruthy();
    expect(context.directory.home).toBeTruthy();
    expect(context.platform.os).toBeTruthy();
    expect(context.platform.arch).toBeTruthy();
    expect(context.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("detects shell information", async () => {
    const context = await collectSystemExecutionContext();
    expect(typeof context.shell.name).toBe("string");
    expect(context.shell.name.length).toBeGreaterThan(0);
  });
});
