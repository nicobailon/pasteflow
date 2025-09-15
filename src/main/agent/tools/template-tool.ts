import { tool, jsonSchema } from "ai";

import { generateFromTemplate } from "../template-engine";

import { clipText } from "./shared/text-utils";
import type { BaseToolFactoryDeps } from "./shared/tool-factory-types";

export function createTemplateTool(_deps: BaseToolFactoryDeps) {
  const inputSchema = {
    type: "object",
    properties: {
      type: { type: "string", enum: ["component", "hook", "api-route", "test"] },
      name: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["type", "name"],
    additionalProperties: false,
  } as const;

  return (tool as any)({
    description: "Generate file previews from a template (no writes)",
    inputSchema: jsonSchema(inputSchema),
    execute: async ({ type, name }: { type: "component" | "hook" | "api-route" | "test"; name: string }) => {
      const result = await generateFromTemplate(name, type as any);
      const clippedFiles = result.files.map((f) => ({
        path: f.path,
        content: clipText(f.content, 40_000),
      }));
      return { ...result, files: clippedFiles };
    },
  });
}
