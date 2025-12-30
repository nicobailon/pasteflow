import path from "node:path";
import fs from "node:fs/promises";

import { Page } from "@playwright/test";

const SCREENSHOTS_DIR = path.resolve(__dirname, "../../../../screenshots");

export async function ensureScreenshotsDir(): Promise<void> {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

export async function takeScreenshot(
  page: Page,
  name: string,
  options?: { fullPage?: boolean }
): Promise<string> {
  await ensureScreenshotsDir();
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const filename = `${name}-${timestamp}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: options?.fullPage ?? false,
  });

  return filepath;
}

export async function takeNamedScreenshot(
  page: Page,
  testName: string,
  stepName: string
): Promise<string> {
  const safeName = `${testName}--${stepName}`.replace(/[^\dA-Za-z-]/g, "_");
  return takeScreenshot(page, safeName);
}
