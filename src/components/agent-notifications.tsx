import React from "react";
import AgentAlertBanner from "./agent-alert-banner";
import type { Notice, ErrorInfoPayload } from "../types/agent-types";

interface AgentNotificationsProps {
  readonly notices: readonly Notice[];
  readonly onDismissNotice: (id: string) => void;
  readonly errorStatus: number | null;
  readonly errorInfo: ErrorInfoPayload | null;
  readonly onDismissError: () => void;
}

const AgentNotifications: React.FC<AgentNotificationsProps> = ({
  notices,
  onDismissNotice,
  errorStatus,
  errorInfo,
  onDismissError,
}) => {
  return (
    <>
      {notices.map((n) => (
        <AgentAlertBanner
          key={n.id}
          variant={n.variant}
          message={n.message}
          onDismiss={() => onDismissNotice(n.id)}
        />
      ))}
      {(() => {
        if (errorStatus === 503) {
          const reason = String(errorInfo?.details && (errorInfo as any).details?.reason || '').toLowerCase();
          const isUnauthorized = reason === 'unauthorized';
          const msg = isUnauthorized
            ? 'AI provider rejected the API key. Click Configure to update credentials.'
            : 'OpenAI API key is missing. Click Configure in the header to add it.';
          return (
            <AgentAlertBanner
              variant="error"
              message={msg}
              onDismiss={onDismissError}
            />
          );
        }
        if (errorStatus === 429) {
          const msg = String(errorInfo?.message || '').toLowerCase();
          const quota = msg.includes('insufficient_quota') || msg.includes('exceeded your current quota') || msg.includes('quota');
          const display = quota
            ? (
                <span>
                  OpenAI quota exceeded. Update your billing plan or switch provider. See provider dashboard for details.
                </span>
              )
            : 'Rate limited (429). Please wait a moment and try again.';
          return (
            <AgentAlertBanner
              variant={quota ? 'error' : 'warning'}
              message={display}
              onDismiss={onDismissError}
            />
          );
        }
        if (errorStatus !== null) {
          const baseMsg = errorInfo?.message && errorInfo.message.trim().length > 0
            ? errorInfo.message
            : 'Please check logs or try again.';
          const codeTxt = errorInfo?.code ? ` [${errorInfo.code}]` : '';
          return (
            <AgentAlertBanner
              variant="error"
              message={`Request failed (${errorStatus})${codeTxt}. ${baseMsg}`}
              onDismiss={onDismissError}
            />
          );
        }
        return null;
      })()}
    </>
  );
};

export default AgentNotifications;

