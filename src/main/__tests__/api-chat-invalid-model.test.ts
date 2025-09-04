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

describe("handleChat invalid model classification", () => {
  it("returns 400 AI_INVALID_MODEL for unknown model errors", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    const err: any = new Error("The model `gpt-5-mini` does not exist");
    err.status = 404;
    (streamText as jest.Mock).mockImplementationOnce(() => { throw err; });

    await handlers.handleChat(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload?.error?.code).toBe('AI_INVALID_MODEL');
  });
});
