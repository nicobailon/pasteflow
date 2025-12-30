import { test, expect } from "../fixtures";

test.describe("User Instructions CLI + UI", () => {
  test("set user instructions via CLI updates UI", async ({
    electronApp,
    cli,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const testContent = `Test instructions ${Date.now()}`;

    const result = await cli([
      "user-instructions",
      "set",
      "--content",
      testContent,
    ]);
    expect(result.exitCode).toBe(0);

    await window.waitForTimeout(1500);

    const textarea = window.locator(".user-instructions-input");
    await expect(textarea).toHaveValue(testContent);

    await takeSnapshot("after-set");

    await cli(["user-instructions", "clear"]);
  });

  test("get user instructions via CLI returns current value", async ({
    electronApp,
    cli,
    cliJson,
  }) => {
    const { window } = electronApp;
    const testContent = `Get test ${Date.now()}`;

    await cli(["user-instructions", "set", "--content", testContent]);
    await window.waitForTimeout(300);

    const getResult = await cliJson<{ content: string }>([
      "user-instructions",
      "get",
    ]);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.data?.content).toBe(testContent);

    await cli(["user-instructions", "clear"]);
  });

  test("clear user instructions via CLI updates UI", async ({
    electronApp,
    cli,
    takeSnapshot,
  }) => {
    const { window } = electronApp;

    await cli([
      "user-instructions",
      "set",
      "--content",
      "Some instructions to clear",
    ]);
    await window.waitForTimeout(300);

    const clearResult = await cli(["user-instructions", "clear"]);
    expect(clearResult.exitCode).toBe(0);

    await window.waitForTimeout(500);

    const textarea = window.locator(".user-instructions-input");
    await expect(textarea).toHaveValue("");

    await takeSnapshot("after-clear");
  });
});
