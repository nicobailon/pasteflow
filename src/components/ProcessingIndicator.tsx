import React from 'react';

interface ProcessingIndicatorProps {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
  isLoadingCancellable: boolean;
  onCancel: () => void;
}

const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({
  status,
  message,
  processed,
  directories,
  total,
  isLoadingCancellable,
  onCancel
}) => {
  if (status !== "processing") return null;

  return (
    <div className="processing-indicator">
      <div className="spinner"></div>
      <span>{message}</span>
      {processed !== undefined && (
        <div className="progress-bar-container">
          <div 
            className="progress-bar" 
            style={{ 
              width: total ? 
                `${Math.min((processed / total) * 100, 100)}%` : 
                `${Math.min(processed * 0.1, 100)}%` 
            }}
          />
          <span className="progress-details">
            {processed.toLocaleString()} files
            {directories ? ` · ${directories.toLocaleString()} directories` : ''}
          </span>
        </div>
      )}
      {isLoadingCancellable && (
        <button 
          className="cancel-button"
          onClick={onCancel}
        >
          Cancel
        </button>
      )}
    </div>
  );
};

export default ProcessingIndicator;