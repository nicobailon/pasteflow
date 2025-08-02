import { useRef, useCallback, useEffect } from 'react';

export interface CancellationToken {
  cancelled: boolean;
  cancel: () => void;
}

export function useCancellableOperation() {
  const activeOperationRef = useRef<CancellationToken | null>(null);

  // Cancel any active operation when component unmounts
  useEffect(() => {
    return () => {
      if (activeOperationRef.current) {
        activeOperationRef.current.cancel();
      }
    };
  }, []);

  const createCancellationToken = useCallback((): CancellationToken => {
    // Cancel any existing operation
    if (activeOperationRef.current) {
      activeOperationRef.current.cancel();
    }

    const token: CancellationToken = {
      cancelled: false,
      cancel() {
        this.cancelled = true;
      }
    };

    activeOperationRef.current = token;
    return token;
  }, []);

  const runCancellableOperation = useCallback(async <T,>(
    operation: (token: CancellationToken) => Promise<T>
  ): Promise<T | null> => {
    const token = createCancellationToken();

    try {
      const result = await operation(token);
      
      // Check if operation was cancelled
      if (token.cancelled) {
        return null;
      }

      return result;
    } finally {
      // Clear the active operation if it's still the current one
      if (activeOperationRef.current === token) {
        activeOperationRef.current = null;
      }
    }
  }, [createCancellationToken]);

  return { runCancellableOperation, createCancellationToken };
}