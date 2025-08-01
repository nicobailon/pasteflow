import React, { useState, useEffect } from 'react';

interface MigrationProgress {
  percent: number;
  message: string;
  details?: unknown;
  timestamp: string;
}

export const MigrationUI: React.FC = () => {
  const [progress, setProgress] = useState<MigrationProgress>({
    percent: 0,
    message: 'Initializing migration...',
    timestamp: new Date().toISOString()
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const handleProgress = (_event: unknown, data: MigrationProgress) => {
      setProgress(data);
      
      setLogs(prev => [
        ...prev,
        `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.message}`
      ]);
      
      if (data.percent === 100) {
        setCompleted(true);
      } else if (data.percent === -1) {
        setError(data.message);
      }
    };

    window.electron.on('migration:progress', handleProgress);
    
    return () => {
      window.electron.removeListener('migration:progress', handleProgress);
    };
  }, []);

  const getProgressColor = () => {
    if (error) return '#ff4444';
    if (completed) return '#44ff44';
    return '#4444ff';
  };

  return (
    <div className="migration-container">
      <div className="migration-dialog">
        <div className="migration-header">
          <h2>PasteFlow Database Upgrade</h2>
          <p className="subtitle">
            Migrating your data to improved storage system
          </p>
        </div>

        <div className="migration-content">
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{
                  width: `${Math.max(0, progress.percent)}%`,
                  backgroundColor: getProgressColor()
                }}
              />
            </div>
            <div className="progress-text">
              {progress.percent >= 0 ? `${progress.percent}%` : 'Error'}
            </div>
          </div>

          <div className="status-message">
            {error ? (
              <div className="error-message">
                <span className="icon">⚠️</span>
                {error}
              </div>
            ) : completed ? (
              <div className="success-message">
                <span className="icon">✅</span>
                Migration completed successfully!
              </div>
            ) : (
              <div className="info-message">
                <span className="spinner">⚡</span>
                {progress.message}
              </div>
            )}
          </div>

          <details className="logs-container">
            <summary>Technical Details</summary>
            <div className="logs">
              {logs.map((log, index) => (
                <div key={index} className="log-entry">
                  {log}
                </div>
              ))}
            </div>
          </details>

          {(error || completed) && (
            <div className="actions">
              {error && (
                <>
                  <button 
                    className="btn-secondary"
                    onClick={() => window.electron.send('migration:retry')}
                  >
                    Retry Migration
                  </button>
                  <button 
                    className="btn-secondary"
                    onClick={() => window.electron.send('migration:restore')}
                  >
                    Restore from Backup
                  </button>
                </>
              )}
              {completed && (
                <button 
                  className="btn-primary"
                  onClick={() => window.location.reload()}
                >
                  Restart Application
                </button>
              )}
            </div>
          )}
        </div>

        <div className="migration-footer">
          <p className="footer-text">
            {error 
              ? "Don't worry, your data is safe. You can retry or restore from backup."
              : completed
              ? "Your data has been successfully migrated to the new storage system."
              : "Please wait while we upgrade your data. This may take a few moments."
            }
          </p>
        </div>
      </div>
    </div>
  );
};