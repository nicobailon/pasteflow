import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { FileData } from "../types/file-types";
import type { AgentAttachment } from "../types/agent-types";
import { requestFileContent } from "../handlers/electron-handlers";

interface UseAttachmentContentLoaderOptions {
  readonly allFiles: readonly FileData[];
  readonly pendingAttachments: ReadonlyMap<string, AgentAttachment>;
  readonly setPendingAttachments: Dispatch<SetStateAction<Map<string, AgentAttachment>>>;
  readonly loadFileContent?: (path: string) => Promise<void>;
}

export default function useAttachmentContentLoader(opts: UseAttachmentContentLoaderOptions) {
  const { allFiles, pendingAttachments, setPendingAttachments, loadFileContent } = opts;

  const ensureAttachmentContent = useCallback(async (path: string): Promise<string> => {
    try {
      const fromPending = pendingAttachments.get(path)?.content;
      if (typeof fromPending === "string") return fromPending;
      const fd = allFiles.find((f) => f.path === path);
      if (fd && fd.isContentLoaded && typeof fd.content === "string") {
        return fd.content;
      }
      try {
        const res = await requestFileContent(path);
        if (res?.success && typeof res.content === "string") {
          setPendingAttachments((prev) => {
            const next = new Map(prev);
            const existing = next.get(path) || ({ path } as AgentAttachment);
            next.set(path, { ...existing, content: res.content });
            return next;
          });
          return res.content;
        }
      } catch { /* ignore */ }
      try { await loadFileContent?.(path); } catch { /* noop */ }
      return "";
    } catch {
      return "";
    }
  }, [allFiles, pendingAttachments, setPendingAttachments, loadFileContent]);

  return { ensureAttachmentContent } as const;
}

