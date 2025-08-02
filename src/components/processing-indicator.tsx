interface ProcessingIndicatorProps {
  status: "idle" | "processing" | "complete" | "error";
  message: string;
  processed?: number;
  directories?: number;
  total?: number;
  isLoadingCancellable: boolean;
  onCancel: () => void;
  treeProgress?: number;
}

const ProcessingIndicator = ({
  status,
  message,
  processed,
  directories,
  total,
  isLoadingCancellable,
  onCancel,
  treeProgress
}: ProcessingIndicatorProps): JSX.Element | null => {
  if (status !== "processing") return null;

  return (
    <div className="processing-indicator">
      <div className="spinner"></div>
      <span>{message}</span>
      {treeProgress !== undefined && treeProgress < 100 && (
        <div className="progress-bar-container tree-progress">
          <div 
            className="progress-bar" 
            style={{ width: `${treeProgress}%` }}
          />
          <span className="progress-details">
            Building file tree: {Math.round(treeProgress)}%
          </span>
        </div>
      )}
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