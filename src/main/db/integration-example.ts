/**
 * Integration example: Upgrading from DatabaseBridge to PooledDatabaseBridge
 * 
 * This file demonstrates how to integrate the new connection pooling system
 * into the existing PasteFlow application with minimal changes.
 */

import { PooledDatabaseBridge, getConfigForEnvironment } from './pooled-database-bridge';

// Example: Updating main.js to use pooled database

class DatabaseManager {
  private database: PooledDatabaseBridge | null = null;
  private initialized = false;

  constructor() {
    this.database = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    console.log('Initializing database with connection pooling...');
    
    // Get environment-specific configuration
    const config = getConfigForEnvironment(process.env.NODE_ENV);
    
    // For production, you might want to customize further
    if (process.env.NODE_ENV === 'production') {
      config.enablePerformanceMonitoring = true;
      config.logSlowQueries = true;
      config.enableBackup = true;
      config.maxReadConnections = 20; // Adjust based on your system
    }

    // Create pooled database instance
    this.database = new PooledDatabaseBridge(config);
    
    // Set up event monitoring
    this.setupEventListeners();
    
    try {
      // Initialize the connection pool
      await this.database.initialize();
      this.initialized = true;
      
      console.log('Database initialized successfully with connection pooling');
      this.logPerformanceStats();
      
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Monitor slow queries for optimization
    this.database.on('slowQuery', (data) => {
      console.warn(`🐌 Slow query detected (${data.duration}ms):`, {
        sql: data.sql.substring(0, 100) + '...',
        params: data.params?.length || 0,
        threshold: data.threshold
      });
    });

    // Monitor cache performance
    this.database.on('cacheHit', (data) => {
      console.log(`💾 Cache hit for query (${data.hitCount} hits, ${data.age}ms old)`);
    });

    // Monitor connection health
    this.database.on('healthCheck', (data) => {
      if (data.unhealthyRemoved > 0) {
        console.warn(`🏥 Health check: removed ${data.unhealthyRemoved} unhealthy connections`);
      }
    });

    // Monitor performance issues
    this.database.on('queryError', (data) => {
      console.error(`❌ Query error on connection ${data.connectionId}:`, {
        sql: data.sql.substring(0, 100),
        error: data.error
      });
    });

    // Monitor initialization
    this.database.on('initialized', (data) => {
      console.log('✅ Database pool initialized:', {
        attempt: data.attempt,
        connections: data.stats.totalConnections,
        utilization: data.performance.poolUtilization
      });
    });
  }

  logPerformanceStats() {
    const stats = this.database.getStats();
    const performance = this.database.getPerformanceMetrics();
    const cache = this.database.getCacheStats();
    
    console.log('📊 Database Performance Stats:');
    console.log(`   Connections: ${stats.activeConnections}/${stats.totalConnections} active`);
    console.log(`   Pool Utilization: ${stats.poolUtilization.toFixed(1)}%`);
    console.log(`   Cache Hit Rate: ${cache?.hitRate.toFixed(1) || 0}%`);
    console.log(`   Avg Query Time: ${performance.averageResponseTime.toFixed(2)}ms`);
  }

  // Periodic performance reporting
  startPerformanceReporting() {
    setInterval(() => {
      const performance = this.database.getPerformanceMetrics();
      const stats = this.database.getStats();
      
      // Log performance summary every 5 minutes
      console.log(`📈 Performance Summary: ${performance.queriesPerSecond.toFixed(1)} qps, ` +
                 `${stats.poolUtilization.toFixed(1)}% utilization, ` +
                 `${performance.cacheHitRate.toFixed(1)}% cache hit rate`);
      
      // Alert on performance issues
      if (performance.poolUtilization > 90) {
        console.warn('⚠️  High pool utilization detected - consider increasing maxReadConnections');
      }
      
      if (performance.averageResponseTime > 200) {
        console.warn('⚠️  High average response time detected - check for slow queries');
      }
      
      if (stats.waitingClients > 10) {
        console.warn('⚠️  High number of waiting clients - pool may be under-provisioned');
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  async close() {
    if (this.database) {
      console.log('Closing database connection pool...');
      await this.database.close();
      this.database = null;
      this.initialized = false;
      console.log('Database closed successfully');
    }
  }

  // Delegate methods to the pooled database bridge
  async listWorkspaces() {
    return this.database.listWorkspaces();
  }

  async createWorkspace(name, folderPath, state = {}) {
    return this.database.createWorkspace(name, folderPath, state);
  }

  async getWorkspace(nameOrId) {
    return this.database.getWorkspace(nameOrId);
  }

  async updateWorkspace(name, state) {
    return this.database.updateWorkspace(name, state);
  }

  async deleteWorkspace(name) {
    return this.database.deleteWorkspace(name);
  }

  async renameWorkspace(oldName, newName) {
    return this.database.renameWorkspace(oldName, newName);
  }

  async touchWorkspace(name) {
    return this.database.touchWorkspace(name);
  }

  async getWorkspaceNames() {
    return this.database.getWorkspaceNames();
  }

  async updateWorkspaceAtomic(name, updates) {
    return this.database.updateWorkspaceAtomic(name, updates);
  }

  async renameWorkspaceAtomic(oldName, newName) {
    return this.database.renameWorkspaceAtomic(oldName, newName);
  }

  async getPreference(key) {
    return this.database.getPreference(key);
  }

  async setPreference(key, value) {
    return this.database.setPreference(key, value);
  }
}

// Example usage in main.js:
/*
import { app } from 'electron';
const databaseManager = new DatabaseManager();

app.whenReady().then(async () => {
  try {
    await databaseManager.initialize();
    databaseManager.startPerformanceReporting();
    
    // Your existing app initialization code...
    
  } catch (error) {
    console.error('Failed to initialize application:', error);
    app.quit();
  }
});

app.on('before-quit', async () => {
  await databaseManager.close();
});

// Export for use in IPC handlers
export { databaseManager };
*/

// For direct replacement in existing code:
/*
// Replace this:
import { DatabaseBridge } from './database-bridge';
let database = new DatabaseBridge();

// With this:
import { DatabaseManager } from './integration-example';
let database = new DatabaseManager();

// All existing method calls remain the same!
*/

export { DatabaseManager };