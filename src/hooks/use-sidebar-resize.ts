import { useEffect, useState } from "react";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 500;

type ResizeMouseEvent = {
  preventDefault: () => void;
  clientX: number;
};

/**
 * Custom hook for managing sidebar resizing functionality
 */
export const useSidebarResize = (initialWidth = 300) => {
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = (e: ResizeMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleResize = (e: globalThis.MouseEvent) => {
      // Calculate width from the right side of the window instead of from the left
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", handleResizeEnd);

    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing]);

  return {
    sidebarWidth,
    handleResizeStart,
    isResizing,
  };
};