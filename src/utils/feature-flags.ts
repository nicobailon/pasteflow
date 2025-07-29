// Feature flag system for controlled rollout of new features
export class FeatureControl {
  private static readonly FLAG_KEY = 'enable-worker-tokens';
  
  static isEnabled(): boolean {
    // For Electron app, check these sources in priority order
    
    // 1. Local storage (user preference or developer setting)
    const stored = localStorage.getItem(this.FLAG_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
    
    // 2. Environment variable (for development)
    // Note: This would need to be passed from main process
    if ((window as any).electronAPI?.env?.ENABLE_WORKER_TOKENS) {
      return true;
    }
    
    // 3. Remote config (if available)
    if ((window as any).remoteConfig?.workerTokens !== undefined) {
      return (window as any).remoteConfig.workerTokens;
    }
    
    // 4. Default to enabled - feature is stable with comprehensive error handling
    return true;
  }
  
  static disable() {
    localStorage.setItem(this.FLAG_KEY, 'false');
    // Reload to apply changes
    window.location.reload();
  }
  
  static enable() {
    localStorage.setItem(this.FLAG_KEY, 'true');
    window.location.reload();
  }
  
  static toggle() {
    if (this.isEnabled()) {
      this.disable();
    } else {
      this.enable();
    }
  }
  
  static clear() {
    localStorage.removeItem(this.FLAG_KEY);
  }
}

// Export convenience constant for easy checking
export const FEATURES = {
  WORKER_TOKEN_COUNTING: FeatureControl.isEnabled()
} as const;