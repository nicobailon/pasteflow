import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";

describe("AgentPanel multi-send behavior", () => {
  it("enables Send again after first message finishes", async () => {
    const files = [] as any[];
    render(<AgentPanel allFiles={files as any} selectedFolder={"/abs"} />);

    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    const send = () => screen.getByText('Send') as HTMLButtonElement;

    // First send
    fireEvent.change(textarea, { target: { value: "Hello 1" } });
    expect(send()).toBeEnabled();
    fireEvent.click(send());

    // Simulated streaming completes via mock; type second message -> button should enable
    await waitFor(() => screen.getByText('assistant'));
    fireEvent.change(textarea, { target: { value: "Hello 2" } });
    await waitFor(() => expect(send()).toBeEnabled());
    fireEvent.click(send());
    await waitFor(() => screen.getAllByText('assistant'));
  });
});
