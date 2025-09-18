import React from "react";
import { Info as InfoIcon } from "lucide-react";

import { TOKEN_COUNTING } from "@constants";

import type { UsageRow } from "../types/agent-types";
import { extractVisibleTextFromMessage, extractReasoningTextFromMessage, condenseUserMessageForDisplay, estimateTokensForText, formatLatency, estimateCostUSD } from "../utils/agent-message-utils";

import AgentToolCalls from "./agent-tool-calls";
import ApprovalTimeline from "./agent-approvals/approval-timeline";

// Local fallback tool catalog (renderer-only) mirrors main/agent/tool-catalog.ts
// Kept in renderer to avoid cross-bundle imports in Vite/Electron.
const FALLBACK_TOOL_CATALOG: readonly { name: string; description: string }[] = [
  { name: 'file', description: 'File ops: read/info/list; writes gated' },
  { name: 'search', description: 'Ripgrep code search' },
  { name: 'edit', description: 'Edit: diff/block/multi; apply gated' },
  { name: 'context', description: 'Context utilities: summary/expand/search/tools' },
  { name: 'terminal', description: 'Terminal: start/interact/output/list/kill (gated)' },
] as const;

// Deduplicate noisy diagnostic logs per assistant message id
const __LOGGED_NO_TEXT_MSG_IDS = new Set<string>();

interface AgentMessagesProps {
  readonly messages: readonly unknown[];
  readonly interruptions: ReadonlyMap<number, { readonly target: 'pre-assistant' | 'assistant'; readonly ts: number }>;
  readonly usageRows: readonly UsageRow[];
  readonly sessionId: string | null;
  readonly bypassApprovals: boolean;
  readonly onToggleBypass: (v: boolean) => void;
  readonly modelId: string | null;
}

const AgentMessages: React.FC<AgentMessagesProps> = ({
  messages,
  interruptions,
  usageRows,
  sessionId,
  bypassApprovals,
  onToggleBypass,
  modelId,
}) => {
  // Preference: default collapsed/expanded for reasoning blocks
  const [defaultReasoningCollapsed, setDefaultReasoningCollapsed] = React.useState<boolean>(false);
  React.useEffect(() => {
    (async () => {
      try {
        const raw = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'ui.reasoning.defaultCollapsed' });
        setDefaultReasoningCollapsed(Boolean((raw as any)?.data ?? raw));
      } catch { /* noop */ }
    })();
  }, []);

  // Track user overrides per assistant message
  const [expandedReasoning, setExpandedReasoning] = React.useState<Set<number>>(() => new Set());
  const [collapsedReasoning, setCollapsedReasoning] = React.useState<Set<number>>(() => new Set());
  const isCollapsed = (idx: number): boolean => (defaultReasoningCollapsed ? !expandedReasoning.has(idx) : collapsedReasoning.has(idx));
  const toggleReasoning = (idx: number) => {
    if (defaultReasoningCollapsed) {
      setExpandedReasoning(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    } else {
      setCollapsedReasoning(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    }
  };
  const toggleDefaultReasoning = async () => {
    const next = !defaultReasoningCollapsed;
    setDefaultReasoningCollapsed(next);
    try { await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'ui.reasoning.defaultCollapsed', value: next }); } catch { /* noop */ }
  };
  // Estimate tokens for assistant entry by pairing with nearest preceding user message
  const estimateTokensForAssistant = (idx: number): { input: number | null; output: number | null; total: number | null } => {
    try {
      const m = messages[idx] as unknown;
      const role = (m && typeof m === 'object' && (m as any).role) ? String((m as any).role) : '';
      if (role !== 'assistant') return { input: null, output: null, total: null };
      const outText = extractVisibleTextFromMessage(m);
      const output = estimateTokensForText(outText);
      let inputText = '';
      for (let i = idx - 1; i >= 0; i--) {
        const r = messages[i] as unknown;
        const rRole = (r && typeof r === 'object' && (r as any).role) ? String((r as any).role) : '';
        if (rRole === 'user') { inputText = extractVisibleTextFromMessage(r); break; }
      }
      const input = estimateTokensForText(inputText);
      const total = input + output;
      return { input, output, total };
    } catch { return { input: null, output: null, total: null }; }
  };

  return (
    <div className="agent-messages" aria-live="polite">
      {sessionId ? (
        <ApprovalTimeline sessionId={sessionId} approvalsEnabled={true} />
      ) : null}
      {messages.length === 0 ? (
        <div className="agent-banner">Start a conversation or send packed content.</div>
      ) : (
        messages.map((m: unknown, idx: number) => {
          const visibleText = extractVisibleTextFromMessage(m);
          const reasoningText = extractReasoningTextFromMessage(m);
          const role = (m && typeof m === 'object' && (m as any).role) ? String((m as any).role) : '';
          let displayText = role === 'user' && typeof visibleText === 'string' ? condenseUserMessageForDisplay(visibleText) : visibleText;

          // Fallback: if assistant text is empty and last user asked about tools, render a local catalog list
          try {
            if (role === 'assistant' && (!displayText || displayText.trim() === '') && (!reasoningText || reasoningText.trim() === '')) {
              // Find nearest preceding user message
              let prevUser: string | null = null;
              for (let j = idx - 1; j >= 0; j--) {
                const item = messages[j] as any;
                if (item?.role === 'user') { prevUser = extractVisibleTextFromMessage(item); break; }
              }
              const isToolQuery = (() => {
                if (!prevUser) return false;
                const t = prevUser.toLowerCase();
                return /\b(which|what|list)\b.*\btools?\b.*\b(avail|have|use)/.test(t);
              })();
              if (isToolQuery) {
                displayText = ['Tools available:', ...FALLBACK_TOOL_CATALOG.map(t => `- ${t.name}: ${t.description}`)].join('\n');
              }

              const hasArray = (Array.isArray((m as any)?.content) && (m as any).content.length > 0) || (Array.isArray((m as any)?.parts) && (m as any).parts.length > 0);
              if (hasArray) {
                try {
                  const msgId = typeof (m as any)?.id === 'string' ? String((m as any).id) : '';
                  if (!msgId || !__LOGGED_NO_TEXT_MSG_IDS.has(msgId)) {
                    // eslint-disable-next-line no-console
                    console.warn('[UI][chat:assistant:no-visible-text]', m);
                    if (msgId) __LOGGED_NO_TEXT_MSG_IDS.add(msgId);
                  }
                } catch { /* noop */ }
              }
            }
          } catch { /* noop */ }

          const it = interruptions.get(idx);
          const assistantInterrupted = Boolean(it && it.target === 'assistant' && role === 'assistant');

          return (
            <div key={idx} style={{ marginBottom: 10, border: assistantInterrupted ? '1px dashed #d99' : undefined, borderRadius: assistantInterrupted ? 4 : undefined, background: assistantInterrupted ? 'rgba(255,0,0,0.03)' : undefined }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{role}</div>
              {/* Reasoning stream (shown first, visually differentiated) */}
              {role === 'assistant' && reasoningText && reasoningText.trim() !== '' ? (
                <div className="agent-reasoning">
                  <div className="agent-reasoning-header">
                    <span className="agent-reasoning-badge">Reasoning</span>
                    <button
                      type="button"
                      onClick={() => toggleReasoning(idx)}
                      className="agent-reasoning-toggle"
                      aria-label={isCollapsed(idx) ? 'Show reasoning' : 'Hide reasoning'}
                    >
                      {isCollapsed(idx) ? 'Show' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleDefaultReasoning}
                      className="agent-reasoning-default-toggle"
                      aria-label={defaultReasoningCollapsed ? 'Set reasoning default to expanded' : 'Set reasoning default to collapsed'}
                      title={defaultReasoningCollapsed ? 'Default: collapsed (click to expand by default)' : 'Default: expanded (click to collapse by default)'}
                    >
                      {defaultReasoningCollapsed ? 'Default: Collapsed' : 'Default: Expanded'}
                    </button>
                  </div>
                  {isCollapsed(idx) ? null : (
                    <div className="agent-reasoning-body">{reasoningText}</div>
                  )}
                </div>
              ) : null}
              {/* Final/output text (full) */}
              <div style={{ whiteSpace: "pre-wrap" }}>{displayText}</div>
              {role === "assistant" ? (
                <AgentToolCalls
                  message={m}
                  sessionId={sessionId || undefined}
                  skipApprovals={bypassApprovals}
                  onToggleSkipApprovals={async (v) => onToggleBypass(Boolean(v))}
                />
              ) : null}
              {role === 'user' && (() => {
                try {
                  const userTok = visibleText ? Math.ceil(visibleText.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
                  const tip = `User message tokens: ${userTok} (approx)`;
                  return (
                    <div className="message-usage-row">
                      <span className="info-icon" aria-label="User token usage">
                        <InfoIcon size={12} />
                        <span className="tooltip-box">{tip}</span>
                      </span>
                      <span>{userTok} tokens</span>
                    </div>
                  );
                } catch { return null; }
              })()}
              {(() => {
                if (role !== 'assistant') return null;
                let aIdx = 0;
                for (let i = 0; i <= idx; i++) { const r = messages[i] as unknown; if (r && typeof r === 'object' && (r as { role?: unknown }).role === 'assistant') aIdx += 1; }
                const usageInfo = usageRows[aIdx - 1] as UsageRow | undefined;
                if (!usageInfo) return null;
                const approxFallback = (!usageInfo.input_tokens && !usageInfo.output_tokens && !usageInfo.total_tokens);
                const approx = approxFallback ? estimateTokensForAssistant(idx) : null;
                const inTok = usageInfo.input_tokens ?? approx?.input ?? null;
                const outTok = usageInfo.output_tokens ?? approx?.output ?? null;
                const totalTok = (typeof usageInfo.total_tokens === 'number') ? usageInfo.total_tokens : ((inTok != null && outTok != null) ? (inTok + outTok) : (approx?.total ?? null));
                const latencyTxt = formatLatency(usageInfo.latency_ms);
                const costTxt = (typeof usageInfo.cost_usd === 'number' && Number.isFinite(usageInfo.cost_usd)) ? `$${usageInfo.cost_usd.toFixed(4)}` : (estimateCostUSD(modelId, usageInfo) || null);
                const tooltipLines = [
                  `Output tokens: ${outTok ?? '—'}${approx && usageInfo.output_tokens == null ? ' (approx)' : ''}`,
                  `Input tokens: ${inTok ?? '—'}${approx && usageInfo.input_tokens == null ? ' (approx)' : ''}`,
                  `Total tokens: ${totalTok ?? '—'}${approx && usageInfo.total_tokens == null ? ' (approx)' : ''}`,
                  (() => {
                    const costSuffix = costTxt ? ` | Cost: ${costTxt}` : '';
                    return `Latency: ${latencyTxt}${costSuffix}`;
                  })(),
                ];
                const tooltip = tooltipLines.join('\n');
                const label = `${(outTok ?? '—')}${approx && usageInfo.output_tokens == null ? ' (approx)' : ''} tokens`;
                return (
                  <div className="message-usage-row">
                    <span className="info-icon" aria-label="Token usage details">
                      <InfoIcon size={12} />
                      <span className="tooltip-box">{tooltip}</span>
                    </span>
                    <span>{label}</span>
                    <span>• {latencyTxt}</span>
                  </div>
                );
              })()}
              {it && (
                <div style={{ marginTop: 4, fontStyle: 'italic', color: '#a00' }}>User interrupted</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default AgentMessages;
