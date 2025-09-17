import { useEffect, useMemo, useState } from "react";

import type { StoredApproval, StoredPreview } from "../../main/agent/approvals-service";
import {
  normalizeServiceResult,
  parseServiceError,
  parseStoredApproval,
  parseStoredPreview,
  type ServiceError,
} from "../../utils/approvals-parsers";

interface ApprovalTimelineProps {
  readonly sessionId: string | null;
  readonly approvalsEnabled: boolean;
}

type TimelineEntry = Readonly<{
  preview: StoredPreview;
  approval: StoredApproval;
}>;

type ApprovalWatchPayload =
  | { readonly type: "agent:approval:new"; readonly preview: unknown; readonly approval: unknown }
  | { readonly type: "agent:approval:update"; readonly approval: unknown };

type ApprovalsBridge = {
  readonly list: (payload: { sessionId: string }) => Promise<unknown>;
  readonly watch: (handlers: {
    readonly onNew?: (payload: ApprovalWatchPayload) => void;
    readonly onUpdate?: (payload: ApprovalWatchPayload) => void;
    readonly onReady?: (payload: unknown) => void;
    readonly onError?: (payload: unknown) => void;
  }) => () => void;
};

function getApprovalsBridge(): ApprovalsBridge | null {
  const candidate = (window as unknown as { electron?: { approvals?: unknown } }).electron?.approvals;
  if (!candidate || typeof candidate !== "object" || candidate === null) return null;
  const required = ["list", "watch"] as const;
  for (const key of required) {
    if (typeof (candidate as Record<string, unknown>)[key] !== "function") return null;
  }
  return candidate as ApprovalsBridge;
}

function formatTimestamp(value: number | null): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function extractPrimaryPath(detail: Readonly<Record<string, unknown>> | null): string | null {
  if (!detail) return null;
  const pathLike = detail.path ?? detail.file ?? detail.targetPath ?? detail.destination;
  return typeof pathLike === "string" ? pathLike : null;
}

function buildEntries(previews: readonly StoredPreview[], approvals: readonly StoredApproval[]): TimelineEntry[] {
  const previewMap = new Map<string, StoredPreview>();
  for (const preview of previews) {
    previewMap.set(preview.id as string, preview);
  }
  const entries: TimelineEntry[] = [];
  for (const approval of approvals) {
    const preview = previewMap.get(approval.previewId as string);
    if (!preview) continue;
    entries.push({ preview, approval });
  }
  entries.sort((a, b) => b.preview.createdAt - a.preview.createdAt);
  return entries;
}

function mergeEntry(entries: TimelineEntry[], next: TimelineEntry): TimelineEntry[] {
  const map = new Map(entries.map((entry) => [entry.preview.id as string, entry] as const));
  map.set(next.preview.id as string, next);
  return [...map.values()].sort((a, b) => b.preview.createdAt - a.preview.createdAt);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  applied: "Applied",
  rejected: "Rejected",
  auto_approved: "Auto approved",
  failed: "Failed",
};

const ApprovalTimeline = ({ sessionId, approvalsEnabled }: ApprovalTimelineProps) => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<ServiceError | null>(null);

  useEffect(() => {
    if (!approvalsEnabled || !sessionId) {
      setEntries([]);
      setError(null);
      return;
    }
    const bridge = getApprovalsBridge();
    if (!bridge) {
      setEntries([]);
      setError({ code: "UNAVAILABLE", message: "Approvals bridge unavailable" });
      return;
    }

    let cancelled = false;
    setLoading(true);

    bridge.list({ sessionId }).then((response) => {
      if (cancelled) return;
      const parsed = normalizeServiceResult<{ previews: unknown; approvals: unknown }>(response);
      if (!parsed.ok) {
        setError(parsed.error);
        setEntries([]);
        return;
      }
      const previewsRaw = Array.isArray(parsed.data?.previews) ? parsed.data.previews : [];
      const approvalsRaw = Array.isArray(parsed.data?.approvals) ? parsed.data.approvals : [];
      const previews: StoredPreview[] = [];
      const approvals: StoredApproval[] = [];
      for (const item of previewsRaw) {
        const preview = parseStoredPreview(item);
        if (preview && preview.sessionId === sessionId) previews.push(preview);
      }
      for (const item of approvalsRaw) {
        const approval = parseStoredApproval(item);
        if (approval && approval.sessionId === sessionId) approvals.push(approval);
      }
      setEntries(buildEntries(previews, approvals));
      setError(null);
    }).catch((error_: unknown) => {
      if (cancelled) return;
      const message = typeof (error_ as { message?: unknown })?.message === "string"
        ? String((error_ as { message: string }).message)
        : "Failed to load approvals";
      setEntries([]);
      setError({ code: "LIST_FAILED", message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    const stopWatch = bridge.watch({
      onNew: (payload) => {
        if (cancelled || !payload || payload.type !== "agent:approval:new") return;
        const preview = parseStoredPreview((payload as { preview: unknown }).preview);
        const approval = parseStoredApproval((payload as { approval: unknown }).approval);
        if (!preview || !approval) return;
        if (preview.sessionId !== sessionId) return;
        setEntries((prev) => mergeEntry(prev, { preview, approval }));
      },
      onUpdate: (payload) => {
        if (cancelled || !payload || payload.type !== "agent:approval:update") return;
        const approval = parseStoredApproval((payload as { approval: unknown }).approval);
        if (!approval || approval.sessionId !== sessionId) return;
        setEntries((prev) => {
          const existing = prev.find((entry) => entry.preview.id === approval.previewId);
          if (!existing) return prev;
          const nextEntry: TimelineEntry = {
            preview: existing.preview,
            approval,
          };
          return mergeEntry(prev, nextEntry);
        });
      },
      onError: (payload) => {
        if (cancelled || !payload) return;
        const err = parseServiceError(payload);
        setError(err);
      },
    });

    return () => {
      cancelled = true;
      try { stopWatch?.(); } catch { /* noop */ }
    };
  }, [sessionId, approvalsEnabled]);

  const content = useMemo(() => {
    if (!approvalsEnabled || !sessionId) {
      return <div className="approval-timeline__empty">Approvals disabled for this session.</div>;
    }
    if (loading) {
      return <div className="approval-timeline__status">Loading approvals timeline…</div>;
    }
    if (error) {
      return <div className="approval-timeline__error" role="alert">{error.message}</div>;
    }
    if (entries.length === 0) {
      return <div className="approval-timeline__empty">No approval activity recorded yet.</div>;
    }
    return entries.map((entry) => {
      const path = extractPrimaryPath(entry.preview.detail);
      const resolvedAt = entry.approval.resolvedAt ?? null;
      const status = entry.approval.status;
      const statusLabel = STATUS_LABELS[status] ?? status;
      const statusClass = `approval-timeline__status approval-timeline__status--${status}`;
      const createdAtLabel = formatTimestamp(entry.preview.createdAt);
      const resolvedLabel = formatTimestamp(resolvedAt);
      return (
        <article
          key={entry.preview.id}
          id={`approval-timeline-${entry.preview.id}`}
          className="approval-timeline__entry"
        >
          <header className="approval-timeline__entry-header">
            <div className="approval-timeline__entry-title">
              <span className="approval-timeline__tool">{entry.preview.tool}</span>
              <span className="approval-timeline__action">{entry.preview.action}</span>
              {path ? <span className="approval-timeline__path" title={path}>{path}</span> : null}
            </div>
            <span className={statusClass}>{statusLabel}</span>
          </header>
          <div className="approval-timeline__entry-body">
            <p className="approval-timeline__summary">{entry.preview.summary}</p>
            <ul className="approval-timeline__events">
              <li><span className="approval-timeline__event-label">Preview:</span> {createdAtLabel || "Unknown time"}</li>
              {status === "pending" ? (
                <li><span className="approval-timeline__event-label">Awaiting decision</span></li>
              ) : (
                <li><span className="approval-timeline__event-label">Resolved:</span> {resolvedLabel || "Unknown time"}{entry.approval.resolvedBy ? ` by ${entry.approval.resolvedBy}` : ""}</li>
              )}
              {entry.approval.autoReason ? (
                <li><span className="approval-timeline__event-label">Auto reason:</span> {entry.approval.autoReason}</li>
              ) : null}
              {entry.approval.feedbackText ? (
                <li><span className="approval-timeline__event-label">Feedback:</span> {entry.approval.feedbackText}</li>
              ) : null}
            </ul>
          </div>
        </article>
      );
    });
  }, [approvalsEnabled, entries, error, loading, sessionId]);

  return (
    <section id="approval-timeline" className="approval-timeline" aria-label="Approvals timeline">
      <header className="approval-timeline__header">Approvals Timeline</header>
      {content}
    </section>
  );
};

export default ApprovalTimeline;
