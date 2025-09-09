import { AgentThreadsLoadSchema } from "../main/ipc/schemas";

describe("AgentThreadsLoadSchema", () => {
  it("accepts sessionId-only input and full input", () => {
    const a = AgentThreadsLoadSchema.safeParse({ sessionId: "abc" });
    const b = AgentThreadsLoadSchema.safeParse({ workspaceId: "ws1", sessionId: "abc" });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  it("rejects empty workspaceId and missing sessionId", () => {
    const c = AgentThreadsLoadSchema.safeParse({ workspaceId: "", sessionId: "abc" });
    const d = AgentThreadsLoadSchema.safeParse({});
    expect(c.success).toBe(false);
    expect(d.success).toBe(false);
  });
});

