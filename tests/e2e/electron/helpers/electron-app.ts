import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { _electron as electron, ElectronApplication, Page } from "@playwright/test";

export interface ElectronTestContext {
  app: ElectronApplication;
  window: Page;
  apiPort: number;
  authToken: string;
}

export async function launchElectronApp(): Promise<ElectronTestContext> {
  const projectRoot = path.resolve(__dirname, "../../../..");

  const app = await electron.launch({
    args: [projectRoot],
    env: {
      ...process.env,
      NODE_ENV: "test",
      PF_TEST_MODE: "1",
    },
    timeout: 60_000,
  });

  const window = await app.firstWindow();

  await window.waitForSelector(".header", { timeout: 30_000 });
  await window.waitForTimeout(1000);

  const apiPort = await readApiPort();
  const authToken = await readAuthToken();

  return { app, window, apiPort, authToken };
}

export async function closeElectronApp(ctx: ElectronTestContext): Promise<void> {
  await ctx.app.close();
}

async function readApiPort(): Promise<number> {
  const portFile = path.join(os.homedir(), ".pasteflow", "server.port");
  const content = await fs.readFile(portFile, "utf8");
  return Number.parseInt(content.trim(), 10);
}

async function readAuthToken(): Promise<string> {
  const tokenFile = path.join(os.homedir(), ".pasteflow", "auth.token");
  const content = await fs.readFile(tokenFile, "utf8");
  return content.trim();
}
