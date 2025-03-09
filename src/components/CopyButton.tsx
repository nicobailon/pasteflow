import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string | (() => string);
  className?: string;
  children?: JSX.Element | string;
}

/**
 * Fallback copy method using a temporary textarea element
 * Used in environments where navigator.clipboard is not available
 * 
 * @param text - Text to copy to clipboard
 * @returns Whether the copy operation was successful
 */
const fallbackCopyTextToClipboard = (text: string): boolean => {
  try {
    // Create a temporary textarea element
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    // Execute copy command
    const successful = document.execCommand("copy");
    
    // Clean up
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("Fallback copy failed:", err);
    return false;
  }
};

/**
 * CopyButton component - Provides a button that copies text to clipboard
 * with visual feedback and accessibility support
 * 
 * @param text - Text to copy or function that returns text to copy
 * @param className - Additional CSS classes
 * @param children - Optional child elements
 */
const CopyButton = ({ text, className = "", children }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Get the text to copy - either use the string directly or call the function
      const textToCopy = typeof text === 'function' ? text() : text;
      
      // Try to use modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
      } else {
        // Fall back to older method if modern API is not available
        const success = fallbackCopyTextToClipboard(textToCopy);
        setCopied(success);
      }

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const statusText = copied ? "Copied to clipboard" : "Copy to clipboard";

  return (
    <button
      type="button"
      className={`copy-button ${className}`}
      onClick={handleCopy}
      title={statusText}
      aria-label={statusText}
      aria-pressed={copied}
      aria-live="polite"
      role="button"
    >
      <span className="sr-only">{statusText}</span>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {children}
    </button>
  );
};

export default CopyButton;
