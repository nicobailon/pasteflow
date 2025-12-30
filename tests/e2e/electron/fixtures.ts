import { test as base } from "@playwright/test";

import {
  ElectronTestContext,
  launchElectronApp,
  closeElectronApp,
} from "./helpers/electron-app";
import { runCli, runCliJson, CliResult } from "./helpers/cli";
import { takeNamedScreenshot } from "./helpers/screenshots";

interface ElectronFixtures {
  electronApp: ElectronTestContext;
  cli: (args: string[]) => Promise<CliResult>;
  cliJson: <T>(
    args: string[]
  ) => Promise<{ exitCode: number; data: T | null; error?: string }>;
  takeSnapshot: (stepName: string) => Promise<string>;
}

export const test = base.extend<ElectronFixtures>({
  electronApp: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const ctx = await launchElectronApp();
      await use(ctx);
      await closeElectronApp(ctx);
    },
    { scope: "worker" },
  ],

  cli: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(runCli);
    },
    { scope: "test" },
  ],

  cliJson: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(runCliJson);
    },
    { scope: "test" },
  ],

  takeSnapshot: [
    async ({ electronApp }, use, testInfo) => {
      const window = electronApp.window;
      const screenshotFn = async (stepName: string) => {
        return takeNamedScreenshot(window, testInfo.title, stepName);
      };
      await use(screenshotFn);
    },
    { scope: "test" },
  ],
});

export { expect } from "@playwright/test";
