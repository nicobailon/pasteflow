import { APIRouteHandlers } from "../../main/api-route-handlers";

// Loose stubs for ctor deps
const dbStub: any = {
  getPreference: async () => null,
  getWorkspace: async () => null,
};

const previewProxyStub: any = {};
const previewControllerStub: any = {};

// Mock ai SDK to capture arguments
jest.mock("ai", () => {
  return {
    streamText: jest.fn(() => ({
      // minimal object with the piping helper used by the code
      pipeUIMessageStreamToResponse: (res: any) => res.status(200).end(),
    })),
    convertToModelMessages: jest.fn((msgs: any) => msgs),
    tool: (def: any) => def, // pass-through for shape introspection only
    jsonSchema: (schema: any) => ({ jsonSchema: schema, validate: async (v: any) => ({ success: true, value: v }) }),
  };
});

jest.mock("@ai-sdk/openai", () => ({ openai: () => ({ id: "test-model" }) }));

describe("handleChat tools wiring", () => {
  it("passes a tools registry to streamText", async () => {
    const handlers = new APIRouteHandlers(dbStub, previewProxyStub, previewControllerStub as any);
    const req: any = { body: { messages: [], context: undefined } };
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res), end: jest.fn() };

    const { streamText } = require("ai");
    await handlers.handleChat(req, res);

    expect(streamText).toHaveBeenCalledTimes(1);
    const arg = (streamText as jest.Mock).mock.calls[0][0];
    expect(arg).toHaveProperty("tools");
    const tools = arg.tools || {};
    // Ensure expected tool names are present (allow additional Phase 4 tools)
    const keys = Object.keys(tools);
    for (const k of ["context", "edit", "file", "search", "terminal"]) {
      expect(keys).toContain(k);
    }
  });
});
