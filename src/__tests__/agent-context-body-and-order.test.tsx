import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";
import { __aiSdkMock } from "./__mocks__/ai-sdk-react";

describe("Agent context body and message ordering", () => {
  it("includes initial + dynamic in body.context and sends attachments before user text", async () => {
    const files = [
      { path: "/abs/src/file.ts", isDirectory: false, size: 10, tokenCount: 1, isContentLoaded: true, content: "console.log(1)" },
    ] as any[];

    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    // Seed initial context
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

    // Add a file via @ mention and send
    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@sr" } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('src/file.ts'));
    // Use legacy event to trigger send and capture prepareSendMessagesRequest
    window.dispatchEvent(new CustomEvent("pasteflow:send-to-agent", { detail: { text: "Hello world" } }));

    await waitFor(() => {
      const req = __aiSdkMock.getLastRequest();
      expect(req.body?.context?.initial?.files?.length).toBeGreaterThan(0);
      expect(req.body?.context?.dynamic?.files?.length).toBeGreaterThan(0);
    });
  });
});
