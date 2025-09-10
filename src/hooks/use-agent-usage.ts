import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { UsageRow, SessionTotals } from "../types/agent-types";

interface UseAgentUsageOptions {
  readonly sessionId: string | null;
  readonly status: string | null;
}

export interface UseAgentUsageResult {
  readonly usageRows: readonly UsageRow[];
  readonly lastUsage: UsageRow | null;
  readonly provider: string | null;
  readonly modelId: string | null;
  refreshUsage: () => Promise<void>;
  readonly sessionTotals: SessionTotals;
}

export default function useAgentUsage(opts: UseAgentUsageOptions): UseAgentUsageResult {
  const { sessionId, status } = opts;

  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [lastUsage, setLastUsage] = useState<UsageRow | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      if (!sessionId) { setUsageRows([]); setLastUsage(null); return; }
      const res: unknown = await window.electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
      if (res && typeof res === 'object' && 'success' in res && (res as { success: boolean }).success === true && Array.isArray((res as { data?: unknown }).data)) {
        const rows = (res as { data?: unknown }).data as UsageRow[];
        setUsageRows(rows);
        setLastUsage(rows[rows.length - 1] || null);
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  // On session change, load usage list
  useEffect(() => { void refreshUsage(); }, [sessionId, refreshUsage]);

  // Refresh when streaming completes
  const lastStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = status;
    const finishedNow = Boolean(prev && (prev === 'streaming' || prev === 'submitted') && !(status === 'streaming' || status === 'submitted'));
    if (finishedNow) {
      setTimeout(() => { void refreshUsage(); }, 75);
    }
  }, [status, refreshUsage]);

  // Fetch provider/model once (cost hints may use modelId)
  useEffect(() => {
    (async () => {
      try {
        const [p, m] = await Promise.all([
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' }),
        ] as const);
        const prov = p && typeof p === 'object' && 'success' in p && (p as { success: boolean }).success === true && typeof (p as { data?: unknown }).data === 'string' ? (p as { data: string }).data : null;
        const mid = m && typeof m === 'object' && 'success' in m && (m as { success: boolean }).success === true && typeof (m as { data?: unknown }).data === 'string' ? (m as { data: string }).data : null;
        setProvider(prov);
        setModelId(mid);
      } catch { /* ignore */ }
    })();
  }, []);

  const sessionTotals: SessionTotals = useMemo(() => {
    try {
      if (Array.isArray(usageRows) && usageRows.length > 0) {
        const hasAnyToken = usageRows.some(r => (
          (typeof r.input_tokens === 'number' && r.input_tokens > 0) ||
          (typeof r.output_tokens === 'number' && r.output_tokens > 0) ||
          (typeof r.total_tokens === 'number' && r.total_tokens > 0)
        ));
        if (hasAnyToken) {
          let inSum = 0, outSum = 0, totalSum = 0; let approx = false; let costSum = 0; let anyCost = false;
          for (const r of usageRows) {
            if (r.input_tokens == null || r.output_tokens == null || r.total_tokens == null) approx = true;
            inSum += r.input_tokens ?? 0;
            outSum += r.output_tokens ?? 0;
            totalSum += (typeof r.total_tokens === 'number' ? r.total_tokens : ((r.input_tokens ?? 0) + (r.output_tokens ?? 0)));
            if (typeof r.cost_usd === 'number' && Number.isFinite(r.cost_usd)) { costSum += r.cost_usd; anyCost = true; }
          }
          return { inSum, outSum, totalSum, approx, costUsd: anyCost ? costSum : null } as const;
        }
      }
    } catch { /* noop */ }
    return { inSum: 0, outSum: 0, totalSum: 0, approx: true, costUsd: null } as const;
  }, [usageRows]);

  return { usageRows, lastUsage, provider, modelId, refreshUsage, sessionTotals };
}
