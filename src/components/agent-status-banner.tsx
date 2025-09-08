import React from "react";

interface AgentStatusBannerProps {
  readonly status: string | null | undefined;
}

const AgentStatusBanner: React.FC<AgentStatusBannerProps> = ({ status }) => (
  <div className="agent-status-banner">
    {status === "streaming" || status === "submitted" ? "Streaming…" : "Ready"}
  </div>
);

export default AgentStatusBanner;

