import React from "react";
import "./agent-alert-banner.css";

type AgentAlertVariant = "error" | "warning" | "info";

type AgentAlertBannerProps = {
  variant?: AgentAlertVariant;
  message: string | React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
};

const AgentAlertBanner: React.FC<AgentAlertBannerProps> = ({
  variant = "info",
  message,
  onDismiss,
  dismissLabel = "Dismiss",
}) => {
  return (
    <div
      role="alert"
      className={`agent-alert-banner ${variant}`}
      aria-live="polite"
    >
      <div className="agent-alert-message">{message}</div>
      {onDismiss && (
        <button className="cancel-button agent-alert-dismiss" onClick={onDismiss}>
          {dismissLabel}
        </button>
      )}
    </div>
  );
};

export default AgentAlertBanner;

