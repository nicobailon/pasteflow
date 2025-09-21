import { fireEvent, render, screen } from "@testing-library/react";

import DiffPreview from "../components/agent-approvals/diff-preview";

describe("DiffPreview", () => {
  it("renders diff hunks and toggles collapse", () => {
    const diffLines = ["@@ -1,1 +1,1 @@", " line1"];
    for (let i = 0; i < 130; i += 1) {
      diffLines.push(`-old_${i}`);
      diffLines.push(`+new_${i}`);
    }
    const diffText = diffLines.join("\n");
    render(<DiffPreview detail={{ diff: diffText }} />);

    expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeInTheDocument();
    expect(screen.getByText(/line1/)).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/Collapse/);
    expect(screen.getByText(/new_129/)).toBeInTheDocument();
  });

  it("shows fallback when diff missing", () => {
    render(<DiffPreview detail={{ original: "a", modified: "b" }} />);
    expect(screen.getByText(/Original/)).toBeInTheDocument();
    expect(screen.getByText(/Modified/)).toBeInTheDocument();
  });
});
