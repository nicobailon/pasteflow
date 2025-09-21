import { useMemo } from "react";

type JsonPreviewProps = Readonly<{
  value: unknown;
  maxLength?: number;
}>;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

export default function JsonPreview({ value, maxLength = 40_000 }: JsonPreviewProps) {
  const text = useMemo(() => {
    const raw = safeStringify(value);
    if (typeof raw !== "string") return "";
    if (raw.length <= maxLength) return raw;
    return `${raw.slice(0, maxLength)}\n… (truncated)`;
  }, [value, maxLength]);

  if (!text) return null;

  return (
    <pre className="json-preview" aria-label="JSON preview body">{text}</pre>
  );
}
