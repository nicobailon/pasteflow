import { APIRouteHandlers } from "../../main/api-route-handlers";

// Loose stubs for ctor deps
const dbStub: any = {
  getPreference: async () => null,
  getWorkspace: async () => null,
};

const previewProxyStub: any = {};
const previewControllerStub: any = {};

// Mock ai SDK and openai
jest.mock("ai", () => {
  const fn = jest.fn();
  return {
    streamText: fn,
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

describe("handleChat error classification", () => {
  it("returns 503 AI_PROVIDER_CONFIG for missing API key errors", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    const err = new Error("OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable.");
    (err as any).name = 'AI_LoadAPIKeyError';
    (streamText as jest.Mock).mockImplementationOnce(() => { throw err; });

    await handlers.handleChat(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload?.error?.code).toBe('AI_PROVIDER_CONFIG');
  });

  it("returns 500 SERVER_ERROR for other errors", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    (streamText as jest.Mock).mockImplementationOnce(() => { throw new Error("Boom"); });

    await handlers.handleChat(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload?.error?.code).toBe('SERVER_ERROR');
  });
});
