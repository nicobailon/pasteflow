import { APIRouteHandlers } from "../../main/api-route-handlers";

// Mock ai SDK and openai
jest.mock("ai", () => {
  const stream = jest.fn();
  return {
    streamText: stream,
    convertToModelMessages: jest.fn((msgs: any) => msgs),
    consumeStream: jest.fn(),
    tool: (def: any) => def,
    jsonSchema: (schema: any) => ({ jsonSchema: schema, validate: async (v: any) => ({ success: true, value: v }) }),
  };
});

jest.mock("@ai-sdk/openai", () => ({ openai: () => ({ id: "test-model" }) }));
// Mock broadcast helper to avoid import.meta.url parsing in Node CJS under Jest
jest.mock("../../main/broadcast-helper", () => ({
  broadcastToRenderers: jest.fn(),
  broadcastWorkspaceUpdated: jest.fn(),
}));

describe("handleChat usage telemetry onFinish", () => {
  it("persists usage with latency via insertUsageSummaryWithLatency when available", async () => {
    const insertWithLatency = jest.fn(async () => {});
    const insertLegacy = jest.fn(async () => {});
    const dbStub: any = {
      getPreference: async () => null,
      getWorkspace: async () => null,
      upsertChatSession: async () => {},
      insertUsageSummary: insertLegacy,
      insertUsageSummaryWithLatency: insertWithLatency,
      insertToolExecution: async () => {},
      listToolExecutions: async () => [],
    };

    const handlers = new APIRouteHandlers(dbStub, {} as any, {} as any);
    const req: any = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }, headers: {}, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    (streamText as jest.Mock).mockImplementationOnce((opts: any) => {
      // Simulate finish callback with usage provided by provider
      setTimeout(() => {
        opts?.onFinish?.({ usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 } });
      }, 0);
      return {
        pipeUIMessageStreamToResponse: (resp: any) => resp.status(200).end(),
      };
    });

    await handlers.handleChat(req, res);

    // Allow microtasks to run the onFinish callback
    await new Promise((r) => setTimeout(r, 1));

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(insertWithLatency).toHaveBeenCalledTimes(1);
    const args = insertWithLatency.mock.calls[0] as any[];
    // args: sessionId, input, output, total, latency
    expect(args[1]).toBe(12);
    expect(args[2]).toBe(34);
    expect(args[3]).toBe(46);
    expect(typeof args[4] === 'number' || args[4] === null).toBe(true);
    expect(insertLegacy).not.toHaveBeenCalled();
  });

  it("falls back to legacy insert when latency method not present", async () => {
    const insertLegacy = jest.fn(async () => {});
    const dbStub: any = {
      getPreference: async () => null,
      getWorkspace: async () => null,
      upsertChatSession: async () => {},
      insertUsageSummary: insertLegacy,
      insertToolExecution: async () => {},
    };

    const handlers = new APIRouteHandlers(dbStub, {} as any, {} as any);
    const req: any = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }, headers: {}, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    ;(streamText as jest.Mock).mockImplementationOnce((opts: any) => {
      setTimeout(() => {
        // Provide only input/output to test total fallback computation
        opts?.onFinish?.({ usage: { inputTokens: 3, outputTokens: 7 } });
      }, 0);
      return {
        pipeUIMessageStreamToResponse: (resp: any) => resp.status(200).end(),
      };
    });

    await handlers.handleChat(req, res);
    await new Promise((r) => setTimeout(r, 1));

    expect(insertLegacy).toHaveBeenCalledTimes(1);
    const args = insertLegacy.mock.calls[0] as any[];
    expect(args[1]).toBe(3);
    expect(args[2]).toBe(7);
    expect(args[3]).toBe(10); // computed total
  });
});
