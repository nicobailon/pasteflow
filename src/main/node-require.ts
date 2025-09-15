import { createRequire } from "node:module";

declare global {
  // Allow the runtime to cache a Node-compatible require for ESM builds
  // eslint-disable-next-line no-var
  var __PF_NODE_REQUIRE__: NodeJS.Require | undefined;
}

function bindModuleRequire(): NodeJS.Require | undefined {
  const nodeModule = typeof module === "undefined" ? undefined : module;
  if (nodeModule && typeof nodeModule.require === "function") {
    const original = nodeModule.require as NodeJS.Require;
    const bound = original.bind(nodeModule) as NodeJS.Require;
    bound.resolve = original.resolve.bind(original);
    bound.cache = original.cache;
    bound.extensions = original.extensions;
    bound.main = original.main;
    return bound;
  }
  return undefined;
}

export function setNodeRequire(importMetaUrl: string): void {
  globalThis.__PF_NODE_REQUIRE__ = createRequire(importMetaUrl);
}

export function getNodeRequire(): NodeJS.Require {
  if (globalThis.__PF_NODE_REQUIRE__) {
    return globalThis.__PF_NODE_REQUIRE__;
  }

  const bound = bindModuleRequire();
  if (bound) {
    globalThis.__PF_NODE_REQUIRE__ = bound;
    return bound;
  }

  throw new Error("Node-compatible require is not available in this environment.");
}
