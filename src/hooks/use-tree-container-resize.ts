import { useEffect, useState, RefObject } from 'react';

export const useTreeContainerResize = (containerRef: RefObject<HTMLDivElement>) => {
  const [treeHeight, setTreeHeight] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTreeHeight(entry.contentRect.height);
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  return treeHeight;
};