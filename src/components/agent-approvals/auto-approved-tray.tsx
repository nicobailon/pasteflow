import type { ApprovalVm } from "../../hooks/use-agent-approvals";

interface AutoApprovedTrayProps {
  readonly autoApproved: readonly ApprovalVm[];
}

export default function AutoApprovedTray({ autoApproved }: AutoApprovedTrayProps) {
  if (!autoApproved || autoApproved.length === 0) {
    return null;
  }

  return (
    <section className="auto-approved-tray" aria-label="Auto-approved requests">
      <header className="auto-approved-tray__header">
        <h3>Auto-approved</h3>
        <span className="auto-approved-tray__count">{autoApproved.length}</span>
      </header>
      <ul className="auto-approved-tray__list">
        {autoApproved.map((approval) => (
          <li key={approval.id} className="auto-approved-tray__item">
            <div className="auto-approved-tray__summary">
              <span className="auto-approved-tray__tool">{approval.tool}</span>
              <span>{approval.summary}</span>
            </div>
            {approval.autoReason ? (
              <div className="auto-approved-tray__reason">Reason: {approval.autoReason}</div>
            ) : null}
            <a className="auto-approved-tray__link" href={`#approval-timeline-${String(approval.previewId)}`}>
              Open timeline
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
