#!/usr/bin/env node
import { Command } from "commander";

import { attachStatusCommand } from "./commands/status";
import { attachWorkspacesCommand } from "./commands/workspaces";
import { attachFoldersCommand } from "./commands/folders";
import { attachInstructionsCommand } from "./commands/instructions";
import { attachPrefsCommand } from "./commands/prefs";
import { attachFilesCommand } from "./commands/files";
import { attachTokensCommand } from "./commands/tokens";
import { attachSelectCommand } from "./commands/select";
import { attachContentCommand } from "./commands/content";

export interface RootOptions {
  host?: string;
  port?: number;
  token?: string;
  json?: boolean;
  timeout?: number;
  raw?: boolean;
  debug?: boolean;
}

async function main() {
  const program = new Command();

  program
    .name("pasteflow")
    .alias("pf")
    .description("PasteFlow CLI — headless operations via the local HTTP API")
    .version("0.1.0")
    .option("--host <host>", "API host (default: 127.0.0.1)")
    .option("--port <port>", "API port", (v) => Number.parseInt(v, 10))
    .option("--token <token>", "Auth token (overrides ~/.pasteflow/auth.token)")
    .option("--json", "Output JSON for scripting", false)
    .option("--timeout <ms>", "Request timeout in ms", (v) => Number.parseInt(v, 10))
    .option("--raw", "Emit raw content (for content/files)", false)
    .option("--debug", "Enable HTTP debug logging", false);

  attachStatusCommand(program);
  attachWorkspacesCommand(program);
  attachFoldersCommand(program);
  attachInstructionsCommand(program);
  attachPrefsCommand(program);
  attachFilesCommand(program);
  attachTokensCommand(program);
  attachSelectCommand(program);
  attachContentCommand(program);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
   
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});