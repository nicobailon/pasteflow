import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { UI } from "../constants/app-constants";
import "./copy-button.css";

interface CopyButtonProps {
  text: string | (() => string) | (() => Promise<string>);
  className?: string;
  children?: JSX.Element | string;
}

/**
 * Small backoff helper to accommodate optimistic/streaming content.
 * Retries resolving text when placeholder is present, up to UI.MODAL.BACKOFF_MAX_ATTEMPTS.
 * This prevents copying "[Content is loading...]" immediately after users click Copy.
 */
const LOADING_PLACEHOLDER_REGEX = /\[Content is loading\.\.\.\]/;

async function resolveTextWithBackoff(source: CopyButtonProps['text']): Promise<string> {
  for (let attempt = 0; attempt < UI.MODAL.BACKOFF_MAX_ATTEMPTS; attempt++) {
    const result = typeof source === 'function' ? (source as any)() : source;
    const text = result instanceof Promise ? await result : result;

    if (text && !LOADING_PLACEHOLDER_REGEX.test(text)) {
      return text;
    }

    if (attempt < UI.MODAL.BACKOFF_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, UI.MODAL.BACKOFF_DELAY_MS));
    }
  }

  // Final attempt: return whatever we have
  const finalResult = typeof source === 'function' ? (source as any)() : source;
  return finalResult instanceof Promise ? await finalResult : finalResult;
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
    
    document.body.append(textArea);
    textArea.focus();
    textArea.select();
    
    // Execute copy command
    const successful = document.execCommand("copy");
    
    // Clean up
    textArea.remove();
    return successful;
  } catch (error) {
    console.error("Fallback copy failed:", error);
    return false;
  }
};

/**
 * CopyButton component - Provides a button that copies text to clipboard
 * with visual feedback and accessibility support
 * 
 * @param text - Text to copy, function that returns text to copy, or async function that resolves to text
 * @param className - Additional CSS classes
 * @param children - Optional child elements
 */
const CopyButton = ({ text, className = "", children }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Resolve text with a small backoff to avoid copying loading placeholders
      const textToCopy = await resolveTextWithBackoff(text);

      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
      } else {
        // Fallback method if modern API is unavailable
        const success = fallbackCopyTextToClipboard(textToCopy);
        setCopied(success);
      }

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
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
    >
      <span className="sr-only">{statusText}</span>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {children}
    </button>
  );
};

export default CopyButton;
