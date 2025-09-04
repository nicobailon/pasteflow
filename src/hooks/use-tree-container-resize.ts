import { useEffect, useState, RefObject, useLayoutEffect } from 'react';

export const useTreeContainerResize = (containerRef: RefObject<HTMLDivElement>) => {
  // Calculate initial height based on container or viewport
  const getInitialHeight = () => {
    const el = containerRef.current;
    if (el) {
      const h = el.clientHeight || el.getBoundingClientRect().height;
      return h > 0 ? h : (typeof window === 'undefined' ? 400 : window.innerHeight * 0.7);
    }
    // Use 70% of viewport height as fallback
    return typeof window === 'undefined' ? 400 : window.innerHeight * 0.7;
  };

  const [treeHeight, setTreeHeight] = useState<number>(getInitialHeight);

  // Use layout effect to get initial height before paint
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight || el.getBoundingClientRect().height;
      if (h > 0) setTreeHeight(h);
    };
    update();
    // Recheck after paint to catch maximize/zoom layout shifts
    const raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
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

  // Fallback: also respond to window resizes (e.g., Electron maximize)
  useEffect(() => {
    const handleWindowResize = () => {
      const el = containerRef.current;
      if (!el) return;
      const next = el.clientHeight || el.getBoundingClientRect().height;
      if (next > 0) setTreeHeight(next);
    };

    // Invoke once to capture post-layout sizing changes
    const raf = requestAnimationFrame(handleWindowResize);
    window.addEventListener('resize', handleWindowResize);
    
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [containerRef]);

  return treeHeight;
};
