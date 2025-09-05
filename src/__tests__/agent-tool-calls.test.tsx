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
    expect(screen.getAllByText(/search/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/file/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows truncated indicator for search results in summary", () => {
    const msg: any = {
      role: "assistant",
      toolInvocations: [
        { toolName: "search", args: { query: "TODO" }, result: { totalMatches: 100, truncated: true } },
      ],
    };
    render(<AgentToolCalls message={msg} />);
    // Summary button should include 'search: 100, truncated' semantics
    const btn = screen.getByRole("button", { name: /Tool calls:/ });
    expect(btn.textContent || '').toMatch(/search: 100/);
    expect(btn.textContent || '').toMatch(/truncated/);
  });
});
