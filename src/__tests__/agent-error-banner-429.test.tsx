import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AgentPanel from "../components/agent-panel";
import { __aiSdkMock } from "./__mocks__/ai-sdk-react";

describe("Agent error banner for 429", () => {
  it("shows and dismisses the 429 banner on onError", async () => {
    render(<AgentPanel allFiles={[]} selectedFolder={null} />);
    const textarea = screen.getByPlaceholderText(/Message the Agent/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByText('Send'));
    // Inject error
    __aiSdkMock.simulateError(429);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

