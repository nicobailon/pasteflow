import React, { useCallback, useEffect, useState, useRef } from 'react';
import { X, Copy, FileText } from 'lucide-react';
import './clipboard-preview-modal.css';

interface ClipboardPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  tokenCount: number;
  onCopy: () => void;
}

const ClipboardPreviewModal: React.FC<ClipboardPreviewModalProps> = ({
  isOpen,
  onClose,
  content,
  tokenCount,
  onCopy
}) => {
  const [buttonText, setButtonText] = useState('Copy to Clipboard');
  const [isCopied, setIsCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
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
  }, [isOpen, onClose]);

  const handleCopyAndNotify = useCallback(() => {
    onCopy();
    setButtonText('Copied!');
    setIsCopied(true);
    
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    
    copyTimeoutRef.current = setTimeout(() => {
      setButtonText('Copy to Clipboard');
      setIsCopied(false);
    }, 2000);
  }, [onCopy]);

  if (!isOpen) return null;

  const isLargeContent = content.length > 100_000;

  return (
    <div 
      className="clipboard-preview-overlay" 
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      role="presentation"
      aria-hidden="true"
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
            onClick={onClose} 
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="clipboard-preview-token-info">
          <span className="clipboard-preview-token-label">Total:</span>
          <span className="clipboard-preview-token-count">~{tokenCount.toLocaleString()} tokens</span>
          {isLargeContent && (
            <span className="clipboard-preview-warning">
              (Large content - {Math.round(content.length / 1000)}KB)
            </span>
          )}
        </div>
        
        <div className="clipboard-preview-content-wrapper">
          <pre className="clipboard-preview-content">
            {isLargeContent ? content.slice(0, 500_000) : content}
            {isLargeContent && content.length > 500_000 && (
              <div className="clipboard-preview-truncated">
                ... Content truncated for display (full content will be copied) ...
              </div>
            )}
          </pre>
        </div>
        
        <div className="clipboard-preview-footer">
          <button className="clipboard-preview-close-btn" onClick={onClose}>
            Close
          </button>
          <button 
            className={`clipboard-preview-copy-btn ${isCopied ? 'copied' : ''}`} 
            onClick={handleCopyAndNotify}
          >
            <Copy size={16} />
            <span>{buttonText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClipboardPreviewModal;