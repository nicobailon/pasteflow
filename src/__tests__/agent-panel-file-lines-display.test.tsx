import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";

describe("AgentPanel displays correct file line counts", () => {
  it("shows actual line count for attached file in chat feed", async () => {
    const files = [
      {
        path: "/abs/src/file.ts",
        isDirectory: false,
        size: 12,
        tokenCount: 1,
        isContentLoaded: true,
        content: "line1\nline2\nline3",
      },
    ] as any[];

    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    // Trigger mention autocomplete and select file
    fireEvent.change(textarea, { target: { value: "Please review @sr" } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('src/file.ts'));

    // Now send a message
    fireEvent.change(textarea, { target: { value: "Please review @src/file.ts" } });
    fireEvent.click(screen.getByText('Send'));

    // Expect condensed display showing 3 lines
    await waitFor(() => expect(screen.getByText(/\[File content: 3 lines\]/)).toBeInTheDocument());
  });
});
