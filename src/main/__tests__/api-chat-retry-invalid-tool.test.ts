import { APIRouteHandlers } from "../../main/api-route-handlers";

// Loose stubs for ctor deps
const dbStub: any = {
  getPreference: async () => null,
  getWorkspace: async () => null,
  upsertChatSession: async () => {},
  insertUsageSummary: async () => {},
  insertToolExecution: async () => {},
};

const previewProxyStub: any = {};
const previewControllerStub: any = {};

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
// Mock broadcast helper to avoid import.meta parsing under Jest
jest.mock("../../main/broadcast-helper", () => ({
  broadcastToRenderers: jest.fn(),
  broadcastWorkspaceUpdated: jest.fn(),
}));

describe("handleChat retries without tools on invalid_function_parameters", () => {
  it("retries once without tools and streams", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    // First call throws invalid_function_parameters
    (streamText as jest.Mock)
      .mockImplementationOnce(() => {
        const err: any = new Error("Invalid schema for function 'file': schema must be a JSON Schema of 'type: \"object\"', got 'type: \"None\"'.");
        err.code = 'invalid_function_parameters';
        err.param = 'tools[0].parameters';
        throw err;
      })
      // Second call returns a stream result
      .mockImplementationOnce(() => ({
        pipeUIMessageStreamToResponse: (resp: any) => resp.status(200).end(),
      }));

    await handlers.handleChat(req, res);

    // First call failed, second call succeeded with 200
    expect(streamText).toHaveBeenCalledTimes(2);
    const first = (streamText as jest.Mock).mock.calls[0][0];
    const second = (streamText as jest.Mock).mock.calls[1][0];
    expect(first.tools).toBeDefined();
    expect(second.tools).toBeUndefined();
  });
});
