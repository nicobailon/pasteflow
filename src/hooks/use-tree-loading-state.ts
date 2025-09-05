import { useEffect, useRef, useState } from "react";

import { ProcessingStatus } from "../handlers/electron-handlers";

/**
 * Custom hook for managing tree loading state with minimum display time
 */
export const useTreeLoadingState = (
  processingStatus: ProcessingStatus | undefined,
  isTreeBuildingComplete: boolean
) => {
  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  const hasEverCompletedRef = useRef<boolean>(false);

  useEffect(() => {
    // Track if we've seen at least one completed tree build
    if (isTreeBuildingComplete) {
      hasEverCompletedRef.current = true;
    }

    const isProcessing = processingStatus?.status === "processing";
    // Only show loading if actively processing, or if we've never completed the initial build yet
    const shouldShowLoading = isProcessing || (!hasEverCompletedRef.current && !isTreeBuildingComplete);

    if (shouldShowLoading) {
      setIsTreeLoading(true);
      
      // Clear any existing timer
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    } else if (!isProcessing && isTreeBuildingComplete && isTreeLoading) {
      // Ensure loading spinner stays visible for at least 800ms to avoid flickering
      const timerId = window.setTimeout(() => {
        setIsTreeLoading(false);
        loadingTimerRef.current = null;
      }, 800);
      
      loadingTimerRef.current = timerId;
    }
    
    return () => {
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
      }
    };
  }, [processingStatus, isTreeLoading, isTreeBuildingComplete]);

  // After first completion, keep the tree visible; only show loading UI when actively processing
  const showLoadingIndicator = isTreeLoading || (!hasEverCompletedRef.current && !isTreeBuildingComplete);

  return { showLoadingIndicator, isTreeLoading };
};
