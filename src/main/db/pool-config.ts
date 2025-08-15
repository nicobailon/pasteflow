import * as os from 'node:os';

import { DatabaseBridgeConfig } from './pooled-database-bridge';

/**
 * Connection pool configuration presets for different usage scenarios
 */

// High-load scenario - maximum performance for heavy concurrent usage
export const HIGH_LOAD_CONFIG: DatabaseBridgeConfig = {
  // Connection pool settings
  minReadConnections: 5,
  maxReadConnections: 25,
  maxWaitingClients: 100,
  acquireTimeout: 10_000, // 10 seconds
  idleTimeout: 180_000, // 3 minutes
  healthCheckInterval: 30_000, // 30 seconds
  
  // Performance monitoring
  enablePerformanceMonitoring: true,
  logSlowQueries: true,
  slowQueryThreshold: 50, // 50ms threshold for high-load
  
  // Aggressive caching
  enableQueryCache: true,
  queryCacheSize: 2000,
  queryCacheTTL: 600_000, // 10 minutes
  
  // Reliability settings
  maxRetries: 5,
  retryDelay: 500,
  
  // Background maintenance
  enableBackup: true,
  backupInterval: 1_800_000, // 30 minutes
  enableMaintenance: true,
  maintenanceInterval: 900_000 // 15 minutes
};

// Standard usage - balanced performance and resource usage
export const STANDARD_CONFIG: DatabaseBridgeConfig = {
  // Connection pool settings
  minReadConnections: 3,
  maxReadConnections: 15,
  maxWaitingClients: 50,
  acquireTimeout: 15_000, // 15 seconds
  idleTimeout: 300_000, // 5 minutes
  healthCheckInterval: 60_000, // 1 minute
  
  // Performance monitoring
  enablePerformanceMonitoring: true,
  logSlowQueries: true,
  slowQueryThreshold: 100, // 100ms threshold
  
  // Moderate caching
  enableQueryCache: true,
  queryCacheSize: 1000,
  queryCacheTTL: 300_000, // 5 minutes
  
  // Standard reliability
  maxRetries: 3,
  retryDelay: 1000,
  
  // Background maintenance
  enableBackup: true,
  backupInterval: 3_600_000, // 1 hour
  enableMaintenance: true,
  maintenanceInterval: 1_800_000 // 30 minutes
};

// Light usage - minimal resource consumption for simple scenarios
export const LIGHT_CONFIG: DatabaseBridgeConfig = {
  // Minimal connection pool
  minReadConnections: 2,
  maxReadConnections: 8,
  maxWaitingClients: 20,
  acquireTimeout: 20_000, // 20 seconds
  idleTimeout: 600_000, // 10 minutes
  healthCheckInterval: 120_000, // 2 minutes
  
  // Basic monitoring
  enablePerformanceMonitoring: false,
  logSlowQueries: false,
  slowQueryThreshold: 200, // 200ms threshold
  
  // Limited caching
  enableQueryCache: true,
  queryCacheSize: 500,
  queryCacheTTL: 180_000, // 3 minutes
  
  // Basic reliability
  maxRetries: 2,
  retryDelay: 2000,
  
  // Minimal background tasks
  enableBackup: true,
  backupInterval: 7_200_000, // 2 hours
  enableMaintenance: false
};

// Development configuration - optimized for debugging and testing
export const DEVELOPMENT_CONFIG: DatabaseBridgeConfig = {
  // Small pool for development
  minReadConnections: 2,
  maxReadConnections: 5,
  maxWaitingClients: 10,
  acquireTimeout: 30_000, // 30 seconds for debugging
  idleTimeout: 120_000, // 2 minutes
  healthCheckInterval: 30_000, // 30 seconds
  
  // Extensive monitoring for debugging
  enablePerformanceMonitoring: true,
  logSlowQueries: true,
  slowQueryThreshold: 10, // 10ms threshold - very sensitive
  
  // No caching to ensure fresh data
  enableQueryCache: false,
  queryCacheSize: 100,
  queryCacheTTL: 60_000, // 1 minute
  
  // Quick retries for development
  maxRetries: 1,
  retryDelay: 100,
  
  // Minimal background tasks
  enableBackup: false,
  enableMaintenance: false
};

// Test configuration - isolated and predictable for testing
export const TEST_CONFIG: DatabaseBridgeConfig = {
  // Minimal pool for tests
  minReadConnections: 1,
  maxReadConnections: 3,
  maxWaitingClients: 5,
  acquireTimeout: 5000, // 5 seconds
  idleTimeout: 30_000, // 30 seconds
  healthCheckInterval: 10_000, // 10 seconds
  
  // No monitoring to avoid noise in tests
  enablePerformanceMonitoring: false,
  logSlowQueries: false,
  slowQueryThreshold: 1000, // 1 second
  
  // No caching for predictable test results
  enableQueryCache: false,
  queryCacheSize: 50,
  queryCacheTTL: 10_000, // 10 seconds
  
  // No retries to fail fast in tests
  maxRetries: 1,
  retryDelay: 50,
  
  // No background tasks in tests
  enableBackup: false,
  enableMaintenance: false
};

/**
 * Get configuration based on environment or usage type
 */
export function getConfigForEnvironment(env?: string): DatabaseBridgeConfig {
  switch (env) {
    case 'production': {
      return HIGH_LOAD_CONFIG;
    }
    case 'staging': {
      return STANDARD_CONFIG;
    }
    case 'development': {
      return DEVELOPMENT_CONFIG;
    }
    case 'test': {
      return TEST_CONFIG;
    }
    default: {
      return STANDARD_CONFIG;
    }
  }
}

/**
 * Create custom configuration with validation
 */
export function createCustomConfig(
  overrides: Partial<DatabaseBridgeConfig>,
  baseConfig: DatabaseBridgeConfig = STANDARD_CONFIG
): DatabaseBridgeConfig {
  const config = { ...baseConfig, ...overrides };
  
  // Validation
  if (config.minReadConnections! < 1) {
    throw new Error('minReadConnections must be at least 1');
  }
  
  if (config.maxReadConnections! < config.minReadConnections!) {
    throw new Error('maxReadConnections must be >= minReadConnections');
  }
  
  if (config.acquireTimeout! < 1000) {
    throw new Error('acquireTimeout must be at least 1000ms');
  }
  
  if (config.idleTimeout! < 30_000) {
    throw new Error('idleTimeout must be at least 30000ms');
  }
  
  if (config.queryCacheSize! < 10) {
    throw new Error('queryCacheSize must be at least 10');
  }
  
  if (config.queryCacheTTL! < 10_000) {
    throw new Error('queryCacheTTL must be at least 10000ms');
  }
  
  return config;
}

/**
 * Configuration recommendations based on system specs
 */
export function getRecommendedConfig(): DatabaseBridgeConfig {
  const totalMemory = os.totalmem();
  const cpuCount = os.cpus().length;
  
  // Memory in GB
  const memoryGB = totalMemory / (1024 * 1024 * 1024);
  
  if (memoryGB >= 16 && cpuCount >= 8) {
    // High-spec system
    return HIGH_LOAD_CONFIG;
  } else if (memoryGB >= 8 && cpuCount >= 4) {
    // Mid-spec system
    return STANDARD_CONFIG;
  } else {
    // Low-spec system
    return LIGHT_CONFIG;
  }
}