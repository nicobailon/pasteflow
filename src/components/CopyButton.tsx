import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string | (() => string);
  className?: string;
  children?: JSX.Element | string;
}

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
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);

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
