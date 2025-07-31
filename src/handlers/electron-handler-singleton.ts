/**
 * Singleton to manage electron handler registration
 * Ensures handlers are only registered once regardless of React re-renders
 * Handles React StrictMode's double rendering behavior
 */

let isHandlersSetup = false;
let cleanupFunction: (() => void) | null = null;
let setupInProgress = false;

export const electronHandlerSingleton = {
  isSetup: () => isHandlersSetup,
  
  setup: (setupFn: () => (() => void)) => {
    // Check if setup is already complete or in progress
    if (isHandlersSetup || setupInProgress) {
      return;
    }
    
    // Mark setup as in progress to prevent concurrent setups
    setupInProgress = true;
    
    try {
      cleanupFunction = setupFn();
      isHandlersSetup = true;
      setupInProgress = false;
    } catch (error) {
      console.error('[ElectronHandlerSingleton] Error setting up handlers:', error);
      isHandlersSetup = false;
      setupInProgress = false;
      throw error;
    }
  },
  
  cleanup: () => {
    if (cleanupFunction && isHandlersSetup) {
      cleanupFunction();
      cleanupFunction = null;
      isHandlersSetup = false;
      setupInProgress = false;
    }
  }
};