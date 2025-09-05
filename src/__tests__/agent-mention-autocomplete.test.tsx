import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";

describe("AgentPanel @-mention autocomplete (agent-local)", () => {
  it("shows dropdown on '@' and inserts selected file mention + adds to pending attachments", async () => {
    const files = [
      {
        path: "/abs/src/file.ts",
        isDirectory: false,
        size: 123,
        tokenCount: 10,
      },
      {
        path: "/abs/README.md",
        isDirectory: false,
        size: 42,
        tokenCount: 3,
      },
    ] as any[];

    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    // Locate the Agent composer textarea
    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;

    // Type a partial @-mention token
    fireEvent.change(textarea, { target: { value: "@fi" } });

    // Expect dropdown to appear with suggestions; "src/file.ts" should be present
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(screen.getByText("src/file.ts")).toBeInTheDocument();
    });

    // Select the suggestion (use mouseDown to prevent blur)
    const suggestion = screen.getByText("src/file.ts");
    fireEvent.mouseDown(suggestion);

    // Composer should contain the inserted mention token
    await waitFor(() => {
      expect(textarea.value).toMatch(/@src\/file\.ts/);
    });

    // Pending attachments list should render and include the selected file
    const attachments = await screen.findByLabelText("Agent context files");
    expect(attachments).toBeInTheDocument();
    expect(attachments.textContent || "").toMatch(/file\.ts/);
  });
});