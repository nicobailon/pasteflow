import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, FileText, X } from 'lucide-react';

import type { PreviewState } from '../hooks/use-preview-generator';
import './clipboard-preview-modal.css';

interface ClipboardPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Fallback/static mode (legacy)
  content?: string;
  tokenCount?: number;
  onCopy: () => void;

  // Progressive streaming mode (worker-driven)
  previewState?: PreviewState;
  onCancel?: () => void;
}

const ClipboardPreviewModal: React.FC<ClipboardPreviewModalProps> = ({
  isOpen,
  onClose,
  content = '',
  tokenCount = 0,
  onCopy,
  previewState,
  onCancel,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();
  const preRef = useRef<HTMLPreElement>(null);

  const usingStreaming = !!previewState;
  const streamStatus = previewState?.status ?? 'idle';
  const processed = previewState?.processed ?? 0;
  const total = previewState?.total ?? 0;
  const percent = previewState?.percent ?? 0;
  const tokenEstimate = usingStreaming ? (previewState?.tokenEstimate ?? 0) : tokenCount;

  const displayText = usingStreaming && streamStatus !== 'complete'
    ? (previewState?.contentForDisplay || content || '')
    : (content || '');

  const fullCopyText = usingStreaming && streamStatus !== 'complete'
    ? (previewState?.fullContent || content || '')
    : (content || '');

  const isLoadingOrStreaming = usingStreaming && (streamStatus === 'loading' || streamStatus === 'streaming');
  const isError = usingStreaming && streamStatus === 'error';
  const isCancelled = usingStreaming && streamStatus === 'cancelled';
  const isComplete = usingStreaming && streamStatus === 'complete';

  const handleClose = useCallback(() => {
    if (usingStreaming && (isLoadingOrStreaming || !isComplete)) {
      try {
        onCancel?.();
      } catch {
        // ignore cancel errors
      }
    }
    onClose();
  }, [usingStreaming, isLoadingOrStreaming, isComplete, onCancel, onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';

      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';

      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }

      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [isOpen, handleClose]);

  const handleCopyAndNotify = useCallback(() => {
    onCopy();
    setIsCopied(true);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  }, [onCopy]);

  // Efficiently update large preview text without heavy React reconciliation
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const next = displayText || '';

    // Incremental append when streaming and content grows monotonically
    if (usingStreaming) {
      const prev = el.textContent || '';
      if (next.startsWith(prev) && next.length >= prev.length) {
        el.append(next.slice(prev.length));
      } else {
        el.textContent = next;
      }
    } else {
      el.textContent = next;
    }
  }, [displayText, usingStreaming, isOpen]); // Added isOpen to ensure content is set when modal reopens

  if (!isOpen) return null;

  const isLargeContent = !usingStreaming && displayText.length > 200_000;

  // Dynamic copy label for streaming mode
  const dynamicCopyLabel = (() => {
    if (!usingStreaming) return 'Copy to Clipboard';
    if (isComplete) return 'Copy all';
    if (isCancelled) return 'Copy available';
    if (isError) return 'Copy (error output)';
    return fullCopyText.length > 0 ? 'Copy available so far' : 'Copy (waiting...)';
  })();

  const copyDisabled = usingStreaming
    ? (!isComplete && fullCopyText.length === 0) // disable when nothing has arrived yet
    : (displayText.length === 0);

  // moved effect above to keep hooks order stable

  return (
    <div
      className="clipboard-preview-overlay"
      onClick={handleClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          handleClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={modalRef}
        className="clipboard-preview-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clipboard-preview-title"
        tabIndex={-1}
      >
        <div className="clipboard-preview-header">
          <div className="clipboard-preview-title" id="clipboard-preview-title">
            <FileText size={20} />
            <span>Preview Clipboard Content</span>
          </div>
          <button
            ref={closeButtonRef}
            className="clipboard-preview-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="clipboard-preview-token-info">
          <span className="clipboard-preview-token-label">Total:</span>
          <span className="clipboard-preview-token-count">
            ~{tokenEstimate.toLocaleString()} tokens
            {/* Recalculating indicator for streaming mode */}
            {isLoadingOrStreaming && (
              <span 
                className="token-recalculating-indicator"
                aria-label="Recalculating token count"
              >
                <span className="recalc-dot recalc-dot-1" aria-hidden="true" />
                <span className="recalc-dot recalc-dot-2" aria-hidden="true" />
                <span className="recalc-dot recalc-dot-3" aria-hidden="true" />
              </span>
            )}
          </span>

          {/* Streaming progress/announcements */}
          {usingStreaming && (
            <div
              style={{ marginLeft: 8, display: 'flex', gap: 8, alignItems: 'center' }}
              aria-live="polite"
            >
              {isLoadingOrStreaming && (
                <>
                  <span>{processed} of {total} files prepared ({percent}%)</span>
                  {/* Minimal progress bar */}
                  <div
                    style={{
                      width: 120,
                      height: 6,
                      background: 'var(--background-secondary)',
                      borderRadius: 3,
                      overflow: 'hidden'
                    }}
                    aria-hidden="true"
                  >
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, percent))}%`,
                        height: '100%',
                        background: 'var(--accent-blue)',
                        transition: 'width 120ms linear'
                      }}
                    />
                  </div>
                </>
              )}
              {isCancelled && <span>(Cancelled)</span>}
              {isError && <span style={{ color: 'var(--warning-color, #ff9800)' }}>(Error)</span>}
            </div>
          )}

          {isLargeContent && !usingStreaming && (
            <span className="clipboard-preview-warning">
              (Large content - {Math.round(displayText.length / 1000)}KB)
            </span>
          )}
        </div>

        <div className="clipboard-preview-content-wrapper">
          <pre
            ref={preRef}
            className="clipboard-preview-content"
            aria-live={usingStreaming ? 'polite' : undefined}
          />
          {!usingStreaming && isLargeContent && (
            <div className="clipboard-preview-truncated">
              ... Content truncated for display (full content will be copied) ...
            </div>
          )}
        </div>

        <div className="clipboard-preview-footer">
          <button className="clipboard-preview-close-btn" onClick={handleClose}>
            Close
          </button>

          {usingStreaming && isLoadingOrStreaming && typeof onCancel === 'function' && (
            <button
              className="clipboard-preview-close-btn"
              onClick={onCancel}
              aria-label="Cancel preview generation"
              title="Cancel preview generation"
            >
              Cancel
            </button>
          )}

          <button
            className={`clipboard-preview-copy-btn ${isCopied ? 'copied' : ''}`}
            onClick={handleCopyAndNotify}
            disabled={copyDisabled}
            aria-disabled={copyDisabled}
            title={isCopied ? 'Copied to clipboard' : dynamicCopyLabel}
          >
            <Copy size={16} />
            <span>{isCopied ? 'Copied!' : dynamicCopyLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClipboardPreviewModal;