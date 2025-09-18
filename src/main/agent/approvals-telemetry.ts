import { nowUnixMs } from "./preview-registry";

export type ApprovalTelemetryEvent = {
  readonly type: "apply" | "reject" | "cancel" | "auto_approve";
  readonly previewId: string;
  readonly sessionId: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly extra?: Record<string, unknown>;
};

export function logApprovalEvent(event: ApprovalTelemetryEvent): void {
  try {
    const payload = {
      ts: nowUnixMs(),
      ...event,
    } as const;
    console.log("[approvals]", JSON.stringify(payload));
  } catch (error) {
    try {
      console.warn("[ApprovalsTelemetry] Failed to log event", error);
    } catch {
      // ignore logging failures
    }
  }
}
