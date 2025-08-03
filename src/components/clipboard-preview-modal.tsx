import React, { useCallback, useEffect } from 'react';
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
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleCopyAndNotify = useCallback(() => {
    onCopy();
    const button = document.querySelector('.clipboard-preview-copy-btn');
    if (button) {
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    }
  }, [onCopy]);

  if (!isOpen) return null;

  return (
    <div 
      className="clipboard-preview-overlay" 
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="clipboard-preview-title"
    >
      <div 
        className="clipboard-preview-modal" 
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="clipboard-preview-header">
          <div className="clipboard-preview-title" id="clipboard-preview-title">
            <FileText size={20} />
            <span>Preview Clipboard Content</span>
          </div>
          <button className="clipboard-preview-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        
        <div className="clipboard-preview-token-info">
          <span className="clipboard-preview-token-label">Total:</span>
          <span className="clipboard-preview-token-count">~{tokenCount.toLocaleString()} tokens</span>
        </div>
        
        <div className="clipboard-preview-content-wrapper">
          <pre className="clipboard-preview-content">{content}</pre>
        </div>
        
        <div className="clipboard-preview-footer">
          <button className="clipboard-preview-close-btn" onClick={onClose}>
            Close
          </button>
          <button className="clipboard-preview-copy-btn" onClick={handleCopyAndNotify}>
            <Copy size={16} />
            <span>Copy to Clipboard</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClipboardPreviewModal;