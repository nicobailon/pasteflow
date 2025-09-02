import { useEffect, useState } from "react";

const MIN_AGENT_WIDTH = 240;
const MAX_AGENT_WIDTH = 560;

type ResizeMouseEvent = {
  preventDefault: () => void;
  clientX: number;
};

/**
 * Resizable left-docked Agent Panel width controller
 */
export const useAgentPanelResize = (initialWidth = 320) => {
  const [agentWidth, setAgentWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = (e: ResizeMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleResize = (e: globalThis.MouseEvent) => {
      // Left-docked panel: width is measured from left edge
      const newWidth = e.clientX;
      if (newWidth >= MIN_AGENT_WIDTH && newWidth <= MAX_AGENT_WIDTH) {
        setAgentWidth(newWidth);
      }
    };

    const handleResizeEnd = () => setIsResizing(false);

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", handleResizeEnd);
    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing]);

  return { agentWidth, handleResizeStart, isResizing };
};

export default useAgentPanelResize;

