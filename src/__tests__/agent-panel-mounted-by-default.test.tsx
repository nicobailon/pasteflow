import React from "react";
import { render, screen } from "@testing-library/react";
import App from "../index";

describe("AgentPanel mounting", () => {
  it("renders AgentPanel by default in the app shell", () => {
    render(<App />);
    const panel = screen.getByTestId("agent-panel");
    expect(panel).toBeInTheDocument();
  });
});

