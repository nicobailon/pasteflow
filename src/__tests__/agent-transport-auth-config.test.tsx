import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";
import { __aiSdkMock } from "./__mocks__/ai-sdk-react";

describe("Agent transport and auth bridging", () => {
  it("passes absolute api and Authorization header; attaches structured context", async () => {
    (window as any).__PF_API_INFO = { apiBase: "http://127.0.0.1:5999", authToken: "TEST_TOKEN" };

    const files = [
      { path: "/abs/src/file.ts", isDirectory: false, size: 10, tokenCount: 1, isContentLoaded: true, content: "console.log(1)" },
    ] as any[];

    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    // Add a mention to create dynamic context
    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@src/file.ts hello" } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('src/file.ts'));
    // Now submit a message
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      const req = __aiSdkMock.getLastRequest();
      expect(req.options.api).toBe("http://127.0.0.1:5999/api/v1/chat");
      expect(req.headers?.Authorization).toBe("Bearer TEST_TOKEN");
      expect(req.body?.context?.version).toBe(1);
      expect(Array.isArray(req.body?.context?.dynamic?.files)).toBe(true);
    });
  });
});

