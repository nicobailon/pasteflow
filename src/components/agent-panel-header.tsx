import React from "react";
import { List as ListIcon, Plus as PlusIcon, Terminal as TerminalIcon, Settings as SettingsIcon } from "lucide-react";

import type { SessionTotals } from "../types/agent-types";
import { estimateCostUSD } from "../utils/agent-message-utils";

interface AgentPanelHeaderProps {
  readonly panelEnabled: boolean;
  readonly status: string | null;
  readonly bypassApprovals: boolean;
  readonly onToggleBypass: (next: boolean) => void;
  readonly onOpenThreads: () => void;
  readonly onToggleTerminal: () => void;
  readonly onNewChat: () => void | Promise<void>;
  readonly onOpenSettings: () => void;
  readonly onOpenIntegrations: () => void;
  readonly showConfigure: boolean;
  readonly onStop: () => void;
  readonly messagesCount: number;
  readonly sessionTotals: SessionTotals;
  readonly modelId: string | null;
}

const AgentPanelHeader: React.FC<AgentPanelHeaderProps> = ({
  panelEnabled,
  status,
  bypassApprovals,
  onToggleBypass,
  onOpenThreads,
  onToggleTerminal,
  onNewChat,
  onOpenSettings,
  onOpenIntegrations,
  showConfigure,
  onStop,
  messagesCount,
  sessionTotals,
  modelId,
}) => {
  const chipInput = sessionTotals.inSum;
  const chipOutput = sessionTotals.outSum;
  const chipTotal = sessionTotals.totalSum;
  const approx = sessionTotals.approx;
  const label = `${chipTotal} ${approx ? '(approx) ' : ''}tokens (in: ${chipInput}, out: ${chipOutput})`;
  const persistedCost = (typeof sessionTotals.costUsd === 'number' && Number.isFinite(sessionTotals.costUsd)) ? `$${sessionTotals.costUsd.toFixed(4)}` : null;
  const estimatedCost = (!persistedCost && (chipInput > 0 || chipOutput > 0)) ? (estimateCostUSD(modelId, { input_tokens: chipInput, output_tokens: chipOutput, total_tokens: chipTotal }) || null) : null;
  const costTxt = persistedCost || estimatedCost || null;
  const hasAnyMessages = messagesCount > 0;
  const costSuffix = costTxt ? `, Cost: ${costTxt}` : '';
  const totalsTitle = `Session totals — Input: ${chipInput}, Output: ${chipOutput}, Total: ${chipTotal}${costSuffix}`;

  return (
    <div className="agent-panel-header">
      <div className="agent-panel-title">Agent</div>
      {(!hasAnyMessages && chipTotal <= 0 && !costTxt) ? null : (
        <div className="agent-usage-chip" title={totalsTitle}>
          <span className="dot" />
          <span>{label}</span>
          {costTxt && (<><span>·</span><span>{costTxt}</span></>)}
        </div>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="secondary" onClick={onOpenThreads} title="Threads" aria-label="Threads" disabled={!panelEnabled}>
          <ListIcon size={16} />
        </button>
        <button
          className={bypassApprovals ? "primary" : "secondary"}
          onClick={() => onToggleBypass(!bypassApprovals)}
          title="Bypass approvals"
          aria-label="Bypass approvals"
          disabled={!panelEnabled}
        >
          {bypassApprovals ? 'Bypass on' : 'Bypass off'}
        </button>
        <button className="secondary" onClick={onToggleTerminal} title="Terminal" aria-label="Terminal" disabled={!panelEnabled}>
          <TerminalIcon size={16} />
        </button>
        <button className="primary" onClick={onNewChat} title="New Chat" aria-label="New Chat" disabled={!panelEnabled}>
          <PlusIcon size={16} />
        </button>
        <button className="secondary" onClick={onOpenSettings} title="Agent Settings" aria-label="Agent Settings" disabled={!panelEnabled}>
          <SettingsIcon size={16} />
        </button>
        {status === "streaming" || status === "submitted" ? (
          <button className="cancel-button" onClick={onStop} title="Stop" aria-label="Stop generation">Stop</button>
        ) : (showConfigure ? (
          <button className="primary" onClick={onOpenIntegrations} title="Configure AI Provider" aria-label="Configure AI Provider" disabled={!panelEnabled}>Configure</button>
        ) : null)}
      </div>
    </div>
  );
};

export default AgentPanelHeader;
