import { test, expect } from "../fixtures";

test.describe("System Prompts CLI + UI", () => {
  test("create system prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const uniqueName = `Test Prompt ${Date.now()}`;

    const result = await cli([
      "system-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "You are a helpful assistant.",
    ]);
    expect(result.exitCode).toBe(0);

    await window.waitForTimeout(1000);
    await window.locator(".system-prompts-button").click();
    await expect(window.getByText(uniqueName)).toBeVisible();

    await takeSnapshot("after-create");
    await window.keyboard.press("Escape");

    const listResult = await cliJson<{ id: string; name: string }[]>([
      "system-prompts",
      "list",
    ]);
    const created = listResult.data?.find((p) => p.name === uniqueName);
    if (created) {
      await cli(["system-prompts", "delete", created.id]);
    }
  });

  test("delete system prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const uniqueName = `To Delete ${Date.now()}`;

    const createResult = await cliJson<{ id: string; name: string }>([
      "system-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "Temporary",
    ]);
    expect(createResult.exitCode).toBe(0);
    expect(createResult.data?.id).toBeTruthy();

    await window.locator(".system-prompts-button").click();
    await expect(window.getByText(uniqueName)).toBeVisible();
    await takeSnapshot("before-delete");

    const deleteResult = await cli([
      "system-prompts",
      "delete",
      createResult.data!.id,
    ]);
    expect(deleteResult.exitCode).toBe(0);

    await window.waitForTimeout(500);

    await expect(window.getByText(uniqueName)).not.toBeVisible();
    await takeSnapshot("after-delete");
    await window.keyboard.press("Escape");
  });

  test("update system prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const timestamp = Date.now();
    const originalName = `Original ${timestamp}`;
    const updatedName = `Updated ${timestamp}`;

    const createResult = await cliJson<{ id: string; name: string }>([
      "system-prompts",
      "create",
      "--name",
      originalName,
      "--content",
      "Original content",
    ]);
    expect(createResult.exitCode).toBe(0);

    const updateResult = await cli([
      "system-prompts",
      "update",
      createResult.data!.id,
      "--name",
      updatedName,
      "--content",
      "Updated content",
    ]);
    expect(updateResult.exitCode).toBe(0);

    await window.waitForTimeout(500);

    await window.locator(".system-prompts-button").click();
    await expect(window.getByText(updatedName)).toBeVisible();
    await expect(window.getByText(originalName)).not.toBeVisible();
    await takeSnapshot("after-update");
    await window.keyboard.press("Escape");

    await cli(["system-prompts", "delete", createResult.data!.id]);
  });

  test("list system prompts via CLI returns data", async ({ electronApp: _electronApp, cli, cliJson }) => {
    const uniqueName = `List Test ${Date.now()}`;

    await cli([
      "system-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "Test content",
    ]);

    const listResult = await cliJson<{ id: string; name: string }[]>([
      "system-prompts",
      "list",
    ]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.data).toBeInstanceOf(Array);

    const found = listResult.data?.find((p) => p.name === uniqueName);
    expect(found).toBeTruthy();

    if (found) {
      await cli(["system-prompts", "delete", found.id]);
    }
  });
});
