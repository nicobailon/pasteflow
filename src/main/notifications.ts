import { Notification } from "electron";

type NotifyPayload = {
  readonly tool: string;
  readonly action: string;
  readonly summary: string;
};

export function notifyPendingApproval(payload: NotifyPayload): void {
  if (typeof Notification !== "function") return;
  if (typeof Notification.isSupported === "function" && !Notification.isSupported()) {
    return;
  }

  try {
    const title = "Agent approval required";
    const body = `${payload.tool}:${payload.action} — ${payload.summary}`;
    const notification = new Notification({ title, body });
    notification.show();
  } catch (error) {
    // Best-effort; ignore failures (common in headless CI)
    if (process.env.NODE_ENV === "development") {
      console.warn?.("[Notifications] Failed to display pending approval notification", error);
    }
  }
}
