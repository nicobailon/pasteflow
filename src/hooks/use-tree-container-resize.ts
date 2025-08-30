import { useEffect, useState, RefObject, useLayoutEffect } from 'react';

export const useTreeContainerResize = (containerRef: RefObject<HTMLDivElement>) => {
  // Calculate initial height based on container or viewport
  const getInitialHeight = () => {
    if (containerRef.current) {
      return containerRef.current.clientHeight || window.innerHeight * 0.7;
    }
    // Use 70% of viewport height as fallback
    return typeof window === 'undefined' ? 400 : window.innerHeight * 0.7;
  };

  const [treeHeight, setTreeHeight] = useState<number>(getInitialHeight);

  // Use layout effect to get initial height before paint
  useLayoutEffect(() => {
    if (containerRef.current) {
      const height = containerRef.current.clientHeight;
      if (height > 0) {
        setTreeHeight(height);
      }
    }
  }, [containerRef]);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (height > 0) {
          setTreeHeight(height);
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  return treeHeight;
};