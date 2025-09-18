import { test, expect } from "@playwright/test";

const harnessPath = "/tests/e2e/approvals-harness.html";

test.describe("Approvals harness", () => {
  test("approves with edits and cancels terminal preview", async ({ page }) => {
    await page.goto(harnessPath);
    await expect(page.getByTestId("pending-count")).toHaveText(/Pending count: 3/);

    // Approve with edits flow
    const editCard = page.locator('article', { hasText: 'Write file 301' });
    await expect(editCard).toBeVisible();
    await page.getByRole("button", { name: "Approve with edits" }).first().click();

    const modal = page.getByRole("heading", { name: "Edit approval payload" });
    await expect(modal).toBeVisible();

    const textarea = page.getByLabel("JSON overrides");
    await textarea.fill('{"path":"/repo/file-301.ts","content":"updated"}');
    const applyButton = page.getByRole("button", { name: "Apply edits" });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();

    await expect(page.getByTestId("pending-count")).toHaveText(/Pending count: 2/);
    await expect(page.getByTestId("harness-log")).toContainText("Approved with edits");

    // Cancel terminal preview
    const terminalCard = page.locator('article', { hasText: 'Terminal command' });
    await expect(terminalCard).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("harness-log")).toContainText("Cancelled");
    await expect(page.getByTestId("pending-count")).toHaveText(/Pending count: 1/);

    // Reject remaining approval with feedback
    const remainingCard = page.locator('article').first();
    await remainingCard.getByLabel("Feedback (optional)").fill("Needs revision");
    await remainingCard.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId("harness-log")).toContainText("Rejected");

    // Toggle bypass state for coverage
    const bypassToggle = page.getByTestId("bypass-toggle").getByRole("checkbox");
    await bypassToggle.check();
    await expect(page.getByTestId("harness-log")).toContainText("Bypass enabled");
    await bypassToggle.uncheck();
    await expect(page.getByTestId("harness-log")).toContainText("Bypass disabled");

    // Auto-approved tray visible
    await expect(page.getByRole("heading", { name: "Auto-approved" })).toBeVisible();

    // Pending count updated
    await expect(page.getByTestId("pending-count")).toHaveText(/Pending count: 0/);
  });
});
