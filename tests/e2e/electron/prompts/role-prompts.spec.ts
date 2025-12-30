import { test, expect } from "../fixtures";

test.describe("Role Prompts CLI + UI", () => {
  test("create role prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const uniqueName = `Test Role ${Date.now()}`;

    const result = await cli([
      "role-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "You are an expert software engineer.",
    ]);
    expect(result.exitCode).toBe(0);

    await window.waitForTimeout(1000);
    await window.locator(".role-prompts-button").click();
    await expect(window.getByText(uniqueName)).toBeVisible();

    await takeSnapshot("after-create");
    await window.keyboard.press("Escape");

    const listResult = await cliJson<{ id: string; name: string }[]>([
      "role-prompts",
      "list",
    ]);
    const created = listResult.data?.find((p) => p.name === uniqueName);
    if (created) {
      await cli(["role-prompts", "delete", created.id]);
    }
  });

  test("delete role prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const uniqueName = `To Delete Role ${Date.now()}`;

    const createResult = await cliJson<{ id: string; name: string }>([
      "role-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "Temporary role",
    ]);
    expect(createResult.exitCode).toBe(0);
    expect(createResult.data?.id).toBeTruthy();

    await window.locator(".role-prompts-button").click();
    await expect(window.getByText(uniqueName)).toBeVisible();
    await takeSnapshot("before-delete");

    const deleteResult = await cli([
      "role-prompts",
      "delete",
      createResult.data!.id,
    ]);
    expect(deleteResult.exitCode).toBe(0);

    await window.waitForTimeout(500);

    await expect(window.getByText(uniqueName)).not.toBeVisible();
    await takeSnapshot("after-delete");
    await window.keyboard.press("Escape");
  });

  test("update role prompt via CLI updates UI", async ({
    electronApp,
    cli,
    cliJson,
    takeSnapshot,
  }) => {
    const { window } = electronApp;
    const timestamp = Date.now();
    const originalName = `Original Role ${timestamp}`;
    const updatedName = `Updated Role ${timestamp}`;

    const createResult = await cliJson<{ id: string; name: string }>([
      "role-prompts",
      "create",
      "--name",
      originalName,
      "--content",
      "Original role content",
    ]);
    expect(createResult.exitCode).toBe(0);

    const updateResult = await cli([
      "role-prompts",
      "update",
      createResult.data!.id,
      "--name",
      updatedName,
      "--content",
      "Updated role content",
    ]);
    expect(updateResult.exitCode).toBe(0);

    await window.waitForTimeout(500);

    await window.locator(".role-prompts-button").click();
    await expect(window.getByText(updatedName)).toBeVisible();
    await expect(window.getByText(originalName)).not.toBeVisible();
    await takeSnapshot("after-update");
    await window.keyboard.press("Escape");

    await cli(["role-prompts", "delete", createResult.data!.id]);
  });

  test("list role prompts via CLI returns data", async ({ electronApp: _electronApp, cli, cliJson }) => {
    const uniqueName = `List Role Test ${Date.now()}`;

    await cli([
      "role-prompts",
      "create",
      "--name",
      uniqueName,
      "--content",
      "Test role content",
    ]);

    const listResult = await cliJson<{ id: string; name: string }[]>([
      "role-prompts",
      "list",
    ]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.data).toBeInstanceOf(Array);

    const found = listResult.data?.find((p) => p.name === uniqueName);
    expect(found).toBeTruthy();

    if (found) {
      await cli(["role-prompts", "delete", found.id]);
    }
  });
});
