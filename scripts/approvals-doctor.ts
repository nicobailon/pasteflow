#!/usr/bin/env tsx

import process from "node:process";

import "../src/main/setup-node-require";
import { DatabaseBridge } from "../src/main/db/database-bridge";
import type { ChatSessionId } from "../src/main/agent/preview-registry";

process.env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE ?? "1";

interface CliOptions {
  readonly sessionId: string | null;
  readonly userDataDir?: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let sessionId: string | null = null;
  let userDataDir: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--session" && index + 1 < argv.length) {
      sessionId = argv[index + 1];
      index += 1;
    } else if (token === "--user-data-dir" && index + 1 < argv.length) {
      userDataDir = argv[index + 1];
      index += 1;
    }
  }

  return { sessionId, userDataDir };
}

const args = process.argv.slice(2);
const options = parseArgs(args);
const sessionId = options.sessionId?.trim() ?? "";

if (sessionId) {
  if (options.userDataDir) {
    process.env.PF_USER_DATA_DIR = options.userDataDir;
  }

  const run = async () => {
    const bridge = new DatabaseBridge();
    try {
      let initialized = true;
      try {
        await bridge.initialize();
      } catch (error) {
        initialized = false;
        console.warn("Approvals doctor: database unavailable, returning empty diagnostics.");
        console.warn(String((error as Error)?.message ?? error));
      }

      if (initialized) {
        const approvalsExport = await bridge.listApprovalsForExport(sessionId as ChatSessionId);
        const counts = {
          pending: 0,
          approved: 0,
          autoApproved: 0,
          applied: 0,
          failed: 0,
          rejected: 0,
          other: 0,
        };

        for (const approval of approvalsExport.approvals) {
          switch (approval.status) {
            case "pending": {
              counts.pending += 1;
              break;
            }
            case "approved": {
              counts.approved += 1;
              break;
            }
            case "auto_approved": {
              counts.autoApproved += 1;
              break;
            }
            case "applied": {
              counts.applied += 1;
              break;
            }
            case "failed": {
              counts.failed += 1;
              break;
            }
            case "rejected": {
              counts.rejected += 1;
              break;
            }
            default: {
              counts.other += 1;
            }
          }
        }

        const rulesPref = await bridge.getPreference("agent.approvals.rules");
        const rulesArray = Array.isArray(rulesPref) ? rulesPref : [];

        const autoCapPref = await bridge.getPreference("agent.approvals.autoCap");
        const autoCap = typeof autoCapPref === "number" && Number.isFinite(autoCapPref)
          ? autoCapPref
          : null;

        const report = {
          sessionId,
          totals: {
            previews: approvalsExport.previews.length,
            approvals: approvalsExport.approvals.length,
          },
          statuses: counts,
          rules: {
            count: rulesArray.length,
            sample: rulesArray.slice(0, 3),
          },
          autoCap,
        } as const;

        console.log(JSON.stringify(report, null, 2));
      } else {
        const emptyReport = {
          sessionId,
          totals: { previews: 0, approvals: 0 },
          statuses: {
            pending: 0,
            approved: 0,
            autoApproved: 0,
            applied: 0,
            failed: 0,
            rejected: 0,
            other: 0,
          },
          rules: { count: 0, sample: [] as unknown[] },
          autoCap: null as number | null,
          note: "Database unavailable or incompatible with current runtime",
        } as const;
        console.log(JSON.stringify(emptyReport, null, 2));
      }
    } catch (error) {
      console.error("Approvals doctor failed:", error);
      process.exitCode = 1;
    } finally {
      await bridge.close();
    }
  };

  await run();
} else {
  console.error("Usage: npx tsx scripts/approvals-doctor.ts --session <session-id> [--user-data-dir <path>]");
  process.exitCode = 1;
}
