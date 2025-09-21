import { useMemo } from "react";

type WindowWithUser = Window & {
  __PF_USER__?: {
    displayName?: string;
    name?: string;
    email?: string;
  };
};

function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

export default function useCurrentUserDisplayName(): string {
  return useMemo(() => {
    try {
      const win = window as WindowWithUser;
      const info = win.__PF_USER__;
      const fromDisplay = sanitizeName(info?.displayName);
      if (fromDisplay) return fromDisplay;
      const fromName = sanitizeName(info?.name);
      if (fromName) return fromName;
      const fromEmail = sanitizeName(info?.email ? info.email.split('@')[0] : undefined);
      if (fromEmail) return fromEmail;
    } catch {
      // ignore resolution errors
    }
    return "user";
  }, []);
}
