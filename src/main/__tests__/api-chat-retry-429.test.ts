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

describe("handleChat provider 429 retry", () => {
  beforeEach(() => {
    process.env.PF_AGENT_RETRY_ATTEMPTS = '3';
    process.env.PF_AGENT_RETRY_BASE_MS = '1';
    process.env.PF_AGENT_RETRY_MAX_MS = '2';
    const { streamText } = require("ai");
    (streamText as jest.Mock).mockClear();
  });

  it("retries pre-pipe 429 and streams on success", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn() };

    const { streamText } = require("ai");
    // First two calls throw 429; third succeeds
    (streamText as jest.Mock)
      .mockImplementationOnce(() => { const e: any = new Error('Too Many Requests'); e.status = 429; throw e; })
      .mockImplementationOnce(() => { const e: any = new Error('Too Many Requests'); e.status = 429; throw e; })
      .mockImplementationOnce(() => ({
        pipeUIMessageStreamToResponse: (resp: any) => resp.status(200).end(),
      }));

    await handlers.handleChat(req, res);

    expect(streamText).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not retry if headers already sent", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], context: undefined }, on: jest.fn() };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn(), on: jest.fn(), headersSent: true };

    const { streamText } = require("ai");
    (streamText as jest.Mock).mockImplementation(() => ({
      pipeUIMessageStreamToResponse: (resp: any) => resp.status(200).end(),
    }));

    await handlers.handleChat(req, res);
    expect(streamText).not.toHaveBeenCalled();
  });
});
