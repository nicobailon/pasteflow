import { render, screen, fireEvent } from "@testing-library/react";
import AgentToolCalls from "../components/agent-tool-calls";

describe("AgentToolCalls", () => {
  it("renders summary and toggles details", () => {
    const msg: any = {
      role: "assistant",
      toolInvocations: [
        { toolName: "search", args: { query: "TODO" }, result: { totalMatches: 2 } },
        { toolName: "file", args: { path: "/repo/a.ts" }, result: { tokenCount: 10 } },
      ],
    };
    render(<AgentToolCalls message={msg} />);
    expect(screen.getByText(/Tool calls:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tool calls:/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tool calls:/ }));
    expect(screen.getByText(/search/)).toBeInTheDocument();
    expect(screen.getByText(/file/)).toBeInTheDocument();
  });
});

