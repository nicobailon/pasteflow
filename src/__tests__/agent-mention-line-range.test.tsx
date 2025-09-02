import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";

describe("Agent @-mention line ranges", () => {
  it("parses @path:10-20 and shows badge", async () => {
    const files = [ { path: "/abs/src/util.ts", isDirectory: false, size: 1, tokenCount: 1 } ] as any[];
    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Please check @sr:10-20" } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('src/util.ts'));

    // Attachment list should include a 10-20 badge
    const badge = await screen.findByText('10-20');
    expect(badge).toBeInTheDocument();
  });
});
