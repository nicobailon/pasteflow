import { useEffect, useRef, useCallback, useState } from 'react';

import { getRendererTokenService, cleanupRendererTokenService } from '../services/token-service-renderer';
import { TokenService } from '../services/token-service';

let refCount = 0;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupScheduled = false;
const CLEANUP_DELAY_MS = 5000;

export interface TokenCountResult {
  count: number;
  backend: string;
}

export interface TokenServiceHook {
  countTokens: (text: string) => Promise<number>;
  countTokensBatch: (texts: string[]) => Promise<number[]>;
  isReady: boolean;
  getBackend: () => Promise<string | null>;
}

export function useTokenService(): TokenServiceHook {
  const serviceRef = useRef<TokenService | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    refCount++;
    
    // Cancel any pending cleanup
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
      cleanupScheduled = false;
    }
    
    serviceRef.current = getRendererTokenService();
    setIsReady(true);
    
    return () => {
      refCount--;
      
      // Schedule cleanup only if not already scheduled and no more refs
      if (refCount === 0 && !cleanupScheduled) {
        cleanupScheduled = true;
        cleanupTimer = setTimeout(() => {
          // Double-check refCount in case new components mounted
          if (refCount === 0) {
            cleanupRendererTokenService();
          }
          cleanupTimer = null;
          cleanupScheduled = false;
        }, CLEANUP_DELAY_MS);
      }
    };
  }, []);
  
  const countTokens = useCallback(async (text: string): Promise<number> => {
    if (!serviceRef.current) {
      throw new Error('Token service not initialized');
    }
    
    const result = await serviceRef.current.countTokens(text);
    return result.count;
  }, []);
  
  const countTokensBatch = useCallback(async (texts: string[]): Promise<number[]> => {
    if (!serviceRef.current) {
      throw new Error('Token service not initialized');
    }
    
    return serviceRef.current.countTokensBatch(texts);
  }, []);
  
  const getBackend = useCallback(async (): Promise<string | null> => {
    if (!serviceRef.current) {
      return null;
    }
    
    return await serviceRef.current.getActiveBackend();
  }, []);
  
  return {
    countTokens,
    countTokensBatch,
    isReady,
    getBackend
  };
}

export function forceCleanupTokenService(): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  
  cleanupScheduled = false;
  cleanupRendererTokenService();
  refCount = 0;
}