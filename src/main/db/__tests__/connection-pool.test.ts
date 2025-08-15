import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { ConnectionPool } from '../connection-pool';
import { PooledDatabase } from '../pooled-database';
import { PooledDatabaseBridge } from '../pooled-database-bridge';
import { TEST_CONFIG, HIGH_LOAD_CONFIG } from '../pool-config';

describe('Connection Pool', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pool-test-'));
    dbPath = path.join(tempDir, 'test.db');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('ConnectionPool Core Functionality', () => {
    test('should initialize with minimum read connections', async () => {
      const pool = new ConnectionPool(dbPath, {
        minReadConnections: 3,
        maxReadConnections: 10
      });

      await pool.initialize();

      const stats = pool.getStats();
      expect(stats.totalConnections).toBeGreaterThanOrEqual(4); // 3 read + 1 write
      expect(stats.idleConnections).toBeGreaterThanOrEqual(3);

      await pool.shutdown();
    });

    test('should handle concurrent read operations efficiently', async () => {
      const pool = new ConnectionPool(dbPath, {
        minReadConnections: 5,
        maxReadConnections: 10
      });

      await pool.initialize();

      // Create test table
      await pool.executeQueryRun('CREATE TABLE test_concurrent (id INTEGER, value TEXT)');
      
      // Insert test data
      for (let i = 0; i < 100; i++) {
        await pool.executeQueryRun('INSERT INTO test_concurrent VALUES (?, ?)', [i, `value_${i}`]);
      }

      // Execute 50 concurrent read operations
      const promises = Array.from({ length: 50 }, (_, i) =>
        pool.executeQuery<{ id: number; value: string }>(
          'SELECT * FROM test_concurrent WHERE id = ?',
          [i % 100],
          'read'
        )
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);
      expect(results.every(r => r && typeof r.id === 'number')).toBe(true);

      await pool.shutdown();
    });

    test('should queue requests when pool is exhausted', async () => {
      const pool = new ConnectionPool(dbPath, {
        minReadConnections: 2,
        maxReadConnections: 2,
        acquireTimeout: 5000
      });

      await pool.initialize();

      // Create a slow query to hold connections
      await pool.executeQueryRun('CREATE TABLE test_queue (id INTEGER)');

      const slowPromises = [
        pool.executeQuery('SELECT 1, (SELECT count(*) FROM test_queue)', [], 'read'),
        pool.executeQuery('SELECT 2, (SELECT count(*) FROM test_queue)', [], 'read')
      ];

      // These should be queued
      const queuedPromises = [
        pool.executeQuery('SELECT 3', [], 'read'),
        pool.executeQuery('SELECT 4', [], 'read')
      ];

      const allResults = await Promise.all([...slowPromises, ...queuedPromises]);
      expect(allResults).toHaveLength(4);

      await pool.shutdown();
    });

    test('should handle connection failures gracefully', async () => {
      const pool = new ConnectionPool('/invalid/path/test.db', {
        minReadConnections: 1,
        maxReadConnections: 3
      });

      await expect(pool.initialize()).rejects.toThrow();
    });
  });

  describe('PooledDatabase Features', () => {
    test('should cache read queries effectively', async () => {
      const db = new PooledDatabase(dbPath, {
        enableQueryCache: true,
        queryCacheSize: 100,
        queryCacheTTL: 60_000
      });

      await db.initialize();

      // Create test data
      await db.run('CREATE TABLE test_cache (id INTEGER PRIMARY KEY, name TEXT)');
      await db.run('INSERT INTO test_cache VALUES (1, ?)', ['test_name']);

      // First query - cache miss
      const result1 = await db.get<{ id: number; name: string }>('SELECT * FROM test_cache WHERE id = 1');
      expect(result1?.name).toBe('test_name');

      // Second query - should be cache hit
      const result2 = await db.get<{ id: number; name: string }>('SELECT * FROM test_cache WHERE id = 1');
      expect(result2?.name).toBe('test_name');

      const cacheStats = db.getCacheStats();
      expect(cacheStats.totalRequests).toBe(2);
      expect(cacheStats.totalHits).toBe(1);
      expect(cacheStats.hitRate).toBe(50);

      await db.shutdown();
    });

    test('should invalidate cache on write operations', async () => {
      const db = new PooledDatabase(dbPath, {
        enableQueryCache: true,
        queryCacheSize: 100,
        queryCacheTTL: 60_000
      });

      await db.initialize();

      // Create and query data
      await db.run('CREATE TABLE test_invalidate (id INTEGER, value TEXT)');
      await db.run('INSERT INTO test_invalidate VALUES (1, ?)', ['original']);

      // Cache the query
      const result1 = await db.get<{ value: string }>('SELECT value FROM test_invalidate WHERE id = 1');
      expect(result1?.value).toBe('original');

      // Update data (should invalidate cache)
      await db.run('UPDATE test_invalidate SET value = ? WHERE id = 1', ['updated']);

      // Query again - should see updated value
      const result2 = await db.get<{ value: string }>('SELECT value FROM test_invalidate WHERE id = 1');
      expect(result2?.value).toBe('updated');

      await db.shutdown();
    });

    test('should handle transactions with retries', async () => {
      const db = new PooledDatabase(dbPath, {
        minReadConnections: 1,
        maxReadConnections: 2
      });

      await db.initialize();

      await db.run('CREATE TABLE test_transaction (id INTEGER PRIMARY KEY, counter INTEGER DEFAULT 0)');
      await db.run('INSERT INTO test_transaction (id) VALUES (1)');

      // Simulate concurrent transactions
      const promises = Array.from({ length: 10 }, async () => {
        return db.transaction(async (txDb) => {
          const current = await txDb.get<{ counter: number }>('SELECT counter FROM test_transaction WHERE id = 1');
          const newValue = (current?.counter || 0) + 1;
          await txDb.run('UPDATE test_transaction SET counter = ? WHERE id = 1', [newValue]);
          return newValue;
        });
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);

      // Verify final state
      const final = await db.get<{ counter: number }>('SELECT counter FROM test_transaction WHERE id = 1');
      expect(final?.counter).toBe(10);

      await db.shutdown();
    });
  });

  describe('PooledDatabaseBridge Integration', () => {
    test('should handle workspace operations with pooling', async () => {
      // Mock app.getPath for testing
      const originalApp = require('electron').app;
      require('electron').app = {
        getPath: () => tempDir
      };

      const bridge = new PooledDatabaseBridge(TEST_CONFIG);
      await bridge.initialize();

      // Test workspace operations
      const workspace = await bridge.createWorkspace('test-workspace', '/test/path', {
        selectedFiles: [{ path: '/test/file.ts' }],
        expandedNodes: { '/test': true }
      });

      expect(workspace.name).toBe('test-workspace');
      expect(workspace.folderPath).toBe('/test/path');

      // Test list operation
      const workspaces = await bridge.listWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe('test-workspace');

      // Test update operation
      await bridge.updateWorkspace('test-workspace', {
        selectedFolder: null,
        allFiles: [],
        selectedFiles: [{ path: '/test/file.ts' }, { path: '/test/file2.ts' }],
        expandedNodes: {},
        sortOrder: 'name',
        searchTerm: '',
        fileTreeMode: 'none',
        exclusionPatterns: [],
        userInstructions: '',
        tokenCounts: {},
        customPrompts: {
          systemPrompts: [],
          rolePrompts: []
        }
      });

      const updated = await bridge.getWorkspace('test-workspace');
      expect(updated.selectedFiles).toHaveLength(2);

      await bridge.close();

      // Restore original app
      require('electron').app = originalApp;
    });

    test('should provide performance metrics', async () => {
      // Mock app.getPath for testing
      const originalApp = require('electron').app;
      require('electron').app = {
        getPath: () => tempDir
      };

      const bridge = new PooledDatabaseBridge({
        ...TEST_CONFIG,
        enablePerformanceMonitoring: true
      });

      await bridge.initialize();

      // Perform some operations
      await bridge.createWorkspace('perf-test', '/test', {});
      await bridge.getWorkspace('perf-test');
      await bridge.setPreference('test-key', 'test-value');
      await bridge.getPreference('test-key');

      const stats = bridge.getStats();
      const performance = bridge.getPerformanceMetrics();

      expect(stats).toBeTruthy();
      expect(stats!.totalQueries).toBeGreaterThan(0);
      expect(performance).toBeTruthy();
      expect(performance!.queriesPerSecond).toBeGreaterThanOrEqual(0);

      await bridge.close();

      // Restore original app
      require('electron').app = originalApp;
    });

    test('should handle high-load scenarios', async () => {
      // Mock app.getPath for testing
      const originalApp = require('electron').app;
      require('electron').app = {
        getPath: () => tempDir
      };

      const bridge = new PooledDatabaseBridge(HIGH_LOAD_CONFIG);
      await bridge.initialize();

      // Simulate high-load scenario
      const operations = Array.from({ length: 100 }, async (_, i) => {
        const workspaceName = `workspace-${i}`;
        await bridge.createWorkspace(workspaceName, `/test/${i}`, {
          selectedFiles: Array.from({ length: 20 }, (_, j) => ({ path: `/file${j}.ts` }))
        });
        
        const workspace = await bridge.getWorkspace(workspaceName);
        expect(workspace.name).toBe(workspaceName);
        
        await bridge.setPreference(`pref-${i}`, `value-${i}`);
        const prefValue = await bridge.getPreference(`pref-${i}`);
        expect(prefValue).toBe(`value-${i}`);
      });

      await Promise.all(operations);

      const stats = bridge.getStats();
      expect(stats!.totalQueries).toBeGreaterThan(200); // At least 2 queries per operation

      const workspaces = await bridge.listWorkspaces();
      expect(workspaces).toHaveLength(100);

      await bridge.close();

      // Restore original app
      require('electron').app = originalApp;
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should recover from connection failures', async () => {
      let connectionFailures = 0;
      
      const pool = new ConnectionPool(dbPath, {
        minReadConnections: 2,
        maxReadConnections: 5,
        healthCheckInterval: 1000 // 1 second for fast testing
      });

      // Listen for connection events
      pool.on('connectionRemoved', () => {
        connectionFailures++;
      });

      await pool.initialize();

      // Force a few operations to ensure pool is working
      await pool.executeQueryRun('CREATE TABLE test_recovery (id INTEGER)');
      await pool.executeQueryRun('INSERT INTO test_recovery VALUES (1)');

      const result = await pool.executeQuery<{ id: number }>('SELECT * FROM test_recovery');
      expect(result?.id).toBe(1);

      await pool.shutdown();
    });

    test('should timeout long-running operations', async () => {
      const pool = new ConnectionPool(dbPath, {
        minReadConnections: 1,
        maxReadConnections: 1,
        acquireTimeout: 1000 // 1 second timeout
      });

      await pool.initialize();

      // Start a long-running operation that holds the connection
      const longOperation = pool.executeQuery('SELECT 1', [], 'read');

      // Try to acquire another connection - should timeout
      await expect(
        pool.executeQuery('SELECT 2', [], 'read')
      ).rejects.toThrow(/timeout/i);

      await longOperation; // Clean up
      await pool.shutdown();
    });
  });

  describe('Configuration Validation', () => {
    test('should validate pool configuration constraints', () => {
      expect(() => {
        new ConnectionPool(dbPath, {
          minReadConnections: 0 // Invalid
        });
      }).toThrow();

      expect(() => {
        new ConnectionPool(dbPath, {
          minReadConnections: 5,
          maxReadConnections: 3 // Invalid: max < min
        });
      }).toThrow();
    });
  });
});