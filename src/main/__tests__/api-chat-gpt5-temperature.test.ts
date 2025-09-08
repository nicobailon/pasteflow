import type { Request, Response } from "express";
import * as AI from "ai";
import type { ModelMessage } from "ai";

import { APIRouteHandlers } from "../../main/api-route-handlers";
import type { DatabaseBridge } from "../../main/db/database-bridge";
import type { RendererPreviewProxy } from "../../main/preview-proxy";
import type { PreviewController } from "../../main/preview-controller";

// Typed stubs for ctor deps (only the methods used by the handler)
type MinimalDB = Pick<
  DatabaseBridge,
  | "getPreference"
  | "getWorkspace"
  | "upsertChatSession"
  | "insertUsageSummary"
  | "insertToolExecution"
>;

const dbStub: MinimalDB = {
  getPreference: async (key: string) => {
    // Mock GPT-5 chat model selection (supports temperature)
    if (key === 'agent.defaultModel') return 'gpt-5-chat-latest';
    if (key === 'agent.temperature') return 0.7;
    return null;
  },
  getWorkspace: async () => null,
  upsertChatSession: async () => {},
  insertUsageSummary: async () => {},
  insertToolExecution: async () => {},
} as MinimalDB;
const previewProxyStub = {} as unknown as RendererPreviewProxy;
const previewControllerStub = {} as unknown as PreviewController;

// Mock ai SDK and openai
jest.mock("ai", () => {
  const fn = jest.fn();
  return {
    streamText: fn,
    convertToModelMessages: jest.fn((msgs: unknown) => msgs as ModelMessage[]),
    consumeStream: jest.fn(),
    tool: (def: unknown) => def,
    jsonSchema: (schema: unknown) => ({ jsonSchema: schema, validate: async (v: unknown) => ({ success: true, value: v }) }),
  };
});

jest.mock("@ai-sdk/openai", () => ({ openai: () => ({ id: "test-model" }) }));
// Mock broadcast helper to avoid import.meta parsing under Jest
jest.mock("../../main/broadcast-helper", () => ({
  broadcastToRenderers: jest.fn(),
  broadcastWorkspaceUpdated: jest.fn(),
}));

describe("handleChat GPT-5 temperature support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes temperature parameter for GPT-5 chat models (default test)", async () => {
    const handlers = new APIRouteHandlers(dbStub as unknown as DatabaseBridge, previewProxyStub, previewControllerStub);
    const req = {
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }], context: undefined },
      on: jest.fn(),
      headers: {},
    } as unknown as Request;
    const resBase = {
      status: jest.fn(() => resBase),
      json: jest.fn(() => resBase),
      end: jest.fn(() => resBase),
      on: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const res = resBase as unknown as Response;

    (AI.streamText as unknown as jest.Mock).mockImplementationOnce((params: unknown) => {
      const p = params as { temperature?: number };
      // Verify that temperature is included for GPT-5
      expect(p.temperature).toBe(0.7);
      return {
        pipeUIMessageStreamToResponse: (resp: Response) => {
          resp.status(200);
          resp.end();
        },
      };
    });

    await handlers.handleChat(req, res);

    expect(AI.streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    // Verify no temperature warning header was set
    expect(res.setHeader).not.toHaveBeenCalledWith('X-Pasteflow-Warning', 'temperature-ignored');
  });

  it("omits temperature parameter for o1 reasoning models", async () => {
    // Mock o1 model selection
    const dbStubO1: MinimalDB = {
      getPreference: async (key: string) => {
        if (key === 'agent.defaultModel') return 'o1-preview';
        if (key === 'agent.temperature') return 0.7;
        return null;
      },
      getWorkspace: async () => null,
      upsertChatSession: async () => {},
      insertUsageSummary: async () => {},
      insertToolExecution: async () => {},
    } as MinimalDB;

    const handlers = new APIRouteHandlers(dbStubO1 as unknown as DatabaseBridge, previewProxyStub, previewControllerStub);
    const req = {
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }], context: undefined },
      on: jest.fn(),
      headers: {},
    } as unknown as Request;
    const resBase = {
      status: jest.fn(() => resBase),
      json: jest.fn(() => resBase),
      end: jest.fn(() => resBase),
      on: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const res = resBase as unknown as Response;

    (AI.streamText as unknown as jest.Mock).mockImplementationOnce((params: unknown) => {
      const p = params as { temperature?: number };
      // Verify that temperature is omitted for o1 models
      expect(p.temperature).toBeUndefined();
      return {
        pipeUIMessageStreamToResponse: (resp: Response) => {
          resp.status(200);
          resp.end();
        },
      };
    });

    await handlers.handleChat(req, res);

    expect(AI.streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    // Verify temperature warning header was set
    expect(res.setHeader).toHaveBeenCalledWith('X-Pasteflow-Warning', 'temperature-ignored');
    expect(res.setHeader).toHaveBeenCalledWith('X-Pasteflow-Warning-Message', 'The temperature setting is not supported for this reasoning model and was ignored.');
  });

  it("omits temperature parameter for GPT-5 reasoning models", async () => {
    // Mock GPT-5 reasoning model selection
    const dbStubGpt5Reasoning: MinimalDB = {
      getPreference: async (key: string) => {
        if (key === 'agent.defaultModel') return 'gpt-5';
        if (key === 'agent.temperature') return 0.7;
        return null;
      },
      getWorkspace: async () => null,
      upsertChatSession: async () => {},
      insertUsageSummary: async () => {},
      insertToolExecution: async () => {},
    } as MinimalDB;

    const handlers = new APIRouteHandlers(dbStubGpt5Reasoning as unknown as DatabaseBridge, previewProxyStub, previewControllerStub);
    const req = {
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }], context: undefined },
      on: jest.fn(),
      headers: {},
    } as unknown as Request;
    const resBase = {
      status: jest.fn(() => resBase),
      json: jest.fn(() => resBase),
      end: jest.fn(() => resBase),
      on: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const res = resBase as unknown as Response;

    (AI.streamText as unknown as jest.Mock).mockImplementationOnce((params: unknown) => {
      const p = params as { temperature?: number };
      // Verify that temperature is omitted for GPT-5 reasoning models
      expect(p.temperature).toBeUndefined();
      return {
        pipeUIMessageStreamToResponse: (resp: Response) => {
          resp.status(200);
          resp.end();
        },
      };
    });

    await handlers.handleChat(req, res);

    expect(AI.streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    // Verify temperature warning header was set
    expect(res.setHeader).toHaveBeenCalledWith('X-Pasteflow-Warning', 'temperature-ignored');
    expect(res.setHeader).toHaveBeenCalledWith('X-Pasteflow-Warning-Message', 'The temperature setting is not supported for this reasoning model and was ignored.');
  });

  it("includes temperature parameter for GPT-5 chat models", async () => {
    // Mock GPT-5 chat model selection
    const dbStubGpt5Chat: MinimalDB = {
      getPreference: async (key: string) => {
        if (key === 'agent.defaultModel') return 'gpt-5-chat-latest';
        if (key === 'agent.temperature') return 0.5;
        return null;
      },
      getWorkspace: async () => null,
      upsertChatSession: async () => {},
      insertUsageSummary: async () => {},
      insertToolExecution: async () => {},
    } as MinimalDB;

    const handlers = new APIRouteHandlers(dbStubGpt5Chat as unknown as DatabaseBridge, previewProxyStub, previewControllerStub);
    const req = {
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }], context: undefined },
      on: jest.fn(),
      headers: {},
    } as unknown as Request;
    const resBase = {
      status: jest.fn(() => resBase),
      json: jest.fn(() => resBase),
      end: jest.fn(() => resBase),
      on: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const res = resBase as unknown as Response;

    (AI.streamText as unknown as jest.Mock).mockImplementationOnce((params: unknown) => {
      const p = params as { temperature?: number };
      // Verify that temperature is included for GPT-5 chat models
      expect(p.temperature).toBe(0.5);
      return {
        pipeUIMessageStreamToResponse: (resp: Response) => {
          resp.status(200);
          resp.end();
        },
      };
    });

    await handlers.handleChat(req, res);

    expect(AI.streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    // Verify no temperature warning header was set
    expect(res.setHeader).not.toHaveBeenCalledWith('X-Pasteflow-Warning', 'temperature-ignored');
  });
});
