import type { SystemExecutionContext, SystemExecutionContextEnvelope } from "../../shared-types/system-execution-context";
import { collectSystemExecutionContext } from "./system-context-collector";

export class SystemContextCache {
  private cache: SystemExecutionContextEnvelope | null = null;

  async getContext(): Promise<SystemExecutionContext> {
    if (!this.cache) await this.refresh();
    return this.cache!.context;
  }

  async refresh(): Promise<void> {
    const context = await collectSystemExecutionContext();
    this.cache = { version: 1, context, generatedAt: Date.now() };
  }
}

export const globalSystemContextCache = new SystemContextCache();
