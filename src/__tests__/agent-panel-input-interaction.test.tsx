import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../index";

describe("AgentPanel input interaction", () => {
  it("allows typing into the agent textarea without errors", () => {
    render(<App />);
    const textarea = screen.getByPlaceholderText(
      /Message the Agent/i
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello agent" } });
    expect(textarea.value).toBe("hello agent");
  });
});

