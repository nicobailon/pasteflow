import React from "react";
import { Info as InfoIcon } from "lucide-react";
import AgentToolCalls from "./agent-tool-calls";
import type { UsageRow } from "../types/agent-types";
import { extractVisibleTextFromMessage, condenseUserMessageForDisplay, estimateTokensForText, formatLatency, estimateCostUSD } from "../utils/agent-message-utils";
import { TOKEN_COUNTING } from "@constants";

interface AgentMessagesProps {
  readonly messages: readonly unknown[];
  readonly interruptions: ReadonlyMap<number, { readonly target: 'pre-assistant' | 'assistant'; readonly ts: number }>;
  readonly usageRows: readonly UsageRow[];
  readonly sessionId: string | null;
  readonly skipApprovals: boolean;
  readonly onToggleSkipApprovals: (v: boolean) => void;
  readonly modelId: string | null;
}

const AgentMessages: React.FC<AgentMessagesProps> = ({
  messages,
  interruptions,
  usageRows,
  sessionId,
  skipApprovals,
  onToggleSkipApprovals,
  modelId,
}) => {
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
      {messages.length === 0 ? (
        <div className="agent-banner">Start a conversation or send packed content.</div>
      ) : (
        messages.map((m: unknown, idx: number) => {
          const rawText = extractVisibleTextFromMessage(m);
          const role = (m && typeof m === 'object' && (m as any).role) ? String((m as any).role) : '';
          const displayText = role === 'user' && typeof rawText === 'string' ? condenseUserMessageForDisplay(rawText) : rawText;
          const it = interruptions.get(idx);
          const assistantInterrupted = Boolean(it && it.target === 'assistant' && role === 'assistant');

          return (
            <div key={idx} style={{ marginBottom: 10, border: assistantInterrupted ? '1px dashed #d99' : undefined, borderRadius: assistantInterrupted ? 4 : undefined, background: assistantInterrupted ? 'rgba(255,0,0,0.03)' : undefined }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{role}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{displayText}</div>
              {role === "assistant" ? (
                <AgentToolCalls
                  message={m}
                  sessionId={sessionId || undefined}
                  skipApprovals={skipApprovals}
                  onToggleSkipApprovals={async (v) => onToggleSkipApprovals(Boolean(v))}
                />
              ) : null}
              {role === 'user' && (() => {
                try {
                  const userTok = rawText ? Math.ceil(rawText.length / TOKEN_COUNTING.CHARS_PER_TOKEN) : 0;
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
                const tooltip = `Output tokens: ${outTok ?? '—'}${approx && usageInfo.output_tokens == null ? ' (approx)' : ''}\n` +
                  `Input tokens: ${inTok ?? '—'}${approx && usageInfo.input_tokens == null ? ' (approx)' : ''}\n` +
                  `Total tokens: ${totalTok ?? '—'}${approx && usageInfo.total_tokens == null ? ' (approx)' : ''}\n` +
                  `Latency: ${latencyTxt}${costTxt ? `\nCost: ${costTxt}` : ''}`;
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

