import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";

describe("Agent initial context auto-submit", () => {
  it("appends a summary user message when receiving structured context", async () => {
    render(<AgentPanel allFiles={[]} selectedFolder={"/abs"} />);

    const envelope = {
      version: 1 as const,
      initial: {
        files: [ { path: "/abs/a.ts", lines: null, relativePath: "a.ts" } ],
        prompts: { system: [], roles: [], instructions: [] },
        user: { present: false, tokenCount: 0 },
        metadata: { totalTokens: 0, signature: "sig", timestamp: Date.now() },
      },
      dynamic: { files: [] },
      workspace: "/abs",
    };

    window.dispatchEvent(new CustomEvent("pasteflow:send-to-agent", { detail: { context: envelope } }));

    await waitFor(() => {
      // The panel should display a user role message containing our summary header
      expect(screen.getByText(/Initial context from PasteFlow/i)).toBeInTheDocument();
    });
  });
});

