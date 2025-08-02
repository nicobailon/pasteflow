const { DatabaseBridge } = require('../database-bridge.js');
const { PasteFlowDatabase } = require('../database-implementation.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock electron app.getPath
const mockApp = {
  getPath: jest.fn()
};

// Mock the electron module
jest.mock('electron', () => ({
  app: mockApp
}));

describe('DatabaseBridge', () => {
  let bridge;
  let tempDir;
  let tempDbPath;

  beforeEach(() => {
    // Create a unique temporary directory for each test
    tempDir = path.join(os.tmpdir(), `bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    tempDbPath = path.join(tempDir, 'test.db');
    
    // Setup mock to return our temp directory
    mockApp.getPath.mockReturnValue(tempDir);
    
    bridge = new DatabaseBridge();
  });

  afterEach(async () => {
    // Clean up bridge and database
    if (bridge) {
      await bridge.close();
    }
    
    // Clean up temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error cleaning up temp directory ${tempDir}:`, error);
    }
    
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully on first attempt', async () => {
      await bridge.initialize();

      expect(bridge.initialized).toBe(true);
      expect(bridge.db).toBeDefined();
      expect(bridge.db).toBeInstanceOf(PasteFlowDatabase);
    });

    it('should only initialize once when called multiple times', async () => {
      await bridge.initialize();
      const firstDb = bridge.db;
      
      await bridge.initialize();
      const secondDb = bridge.db;

      expect(firstDb).toBe(secondDb);
      expect(bridge.initialized).toBe(true);
    });

    it('should retry on initialization failure and succeed', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Make the first attempt fail by providing invalid path
      let attemptCount = 0;
      const originalGetPath = mockApp.getPath;
      mockApp.getPath.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          return '/invalid/path/that/does/not/exist';
        }
        return tempDir;
      });

      await bridge.initialize(3, 100); // 3 retries, 100ms delay

      expect(bridge.initialized).toBe(true);
      expect(bridge.db).toBeDefined();
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
      mockApp.getPath.mockImplementation(originalGetPath);
    });

    it('should fall back to in-memory database after all retries fail', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Make all attempts fail
      mockApp.getPath.mockReturnValue('/completely/invalid/path/that/will/always/fail');

      await bridge.initialize(2, 50); // 2 retries, 50ms delay

      expect(bridge.initialized).toBe(true);
      expect(bridge.db).toBeDefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database initialized in memory mode')
      );
      
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should throw error if in-memory fallback also fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Mock PasteFlowDatabase constructor to always throw
      const originalPasteFlowDatabase = require('../database-implementation.js').PasteFlowDatabase;
      const mockConstructor = jest.fn().mockImplementation(() => {
        throw new Error('Mock database failure');
      });
      
      // Replace the constructor
      jest.doMock('../database-implementation.js', () => ({
        PasteFlowDatabase: mockConstructor
      }));
      
      // Create new bridge instance to use mocked constructor
      const failingBridge = new DatabaseBridge();

      await expect(failingBridge.initialize(1, 10)).rejects.toThrow();
      
      consoleSpy.mockRestore();
      
      // Restore original module
      jest.doMock('../database-implementation.js', () => ({
        PasteFlowDatabase: originalPasteFlowDatabase
      }));
    });

    it('should handle SQLITE_BUSY errors with proper cleanup', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      let attemptCount = 0;
      const originalPasteFlowDatabase = require('../database-implementation.js').PasteFlowDatabase;
      
      const mockConstructor = jest.fn().mockImplementation((dbPath) => {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new Error('Database is busy');
          error.code = 'SQLITE_BUSY';
          throw error;
        }
        return new originalPasteFlowDatabase(dbPath);
      });
      
      jest.doMock('../database-implementation.js', () => ({
        PasteFlowDatabase: mockConstructor
      }));
      
      const retryBridge = new DatabaseBridge();
      await retryBridge.initialize(3, 50);

      expect(retryBridge.initialized).toBe(true);
      expect(mockConstructor).toHaveBeenCalledTimes(2);
      
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
      
      jest.doMock('../database-implementation.js', () => ({
        PasteFlowDatabase: originalPasteFlowDatabase
      }));
      
      await retryBridge.close();
    });
  });

  describe('Workspace Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    const testWorkspace = {
      name: 'Test Workspace',
      folderPath: '/test/path',
      state: {
        selectedFiles: ['file1.txt'],
        expandedNodes: { '/test': true }
      }
    };

    it('should create workspace through bridge', async () => {
      const workspace = await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      expect(workspace).toBeDefined();
      expect(workspace.name).toBe(testWorkspace.name);
      expect(workspace.folderPath).toBe(testWorkspace.folderPath);
      expect(workspace.state).toEqual(testWorkspace.state);
    });

    it('should list workspaces through bridge', async () => {
      await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      const workspaces = await bridge.listWorkspaces();

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe(testWorkspace.name);
    });

    it('should get workspace through bridge', async () => {
      await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      const workspace = await bridge.getWorkspace(testWorkspace.name);

      expect(workspace).toBeDefined();
      expect(workspace.name).toBe(testWorkspace.name);
    });

    it('should update workspace through bridge', async () => {
      await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      const newState = { selectedFiles: ['file2.txt'] };
      await bridge.updateWorkspace(testWorkspace.name, newState);

      const updated = await bridge.getWorkspace(testWorkspace.name);
      expect(updated.state).toEqual(newState);
    });

    it('should delete workspace through bridge', async () => {
      await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      await bridge.deleteWorkspace(testWorkspace.name);

      const workspace = await bridge.getWorkspace(testWorkspace.name);
      expect(workspace).toBeNull();
    });

    it('should rename workspace through bridge', async () => {
      await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      const newName = 'Renamed Workspace';
      await bridge.renameWorkspace(testWorkspace.name, newName);

      const oldWorkspace = await bridge.getWorkspace(testWorkspace.name);
      const newWorkspace = await bridge.getWorkspace(newName);

      expect(oldWorkspace).toBeNull();
      expect(newWorkspace).toBeDefined();
      expect(newWorkspace.name).toBe(newName);
    });

    it('should touch workspace through bridge', async () => {
      const workspace = await bridge.createWorkspace(
        testWorkspace.name,
        testWorkspace.folderPath,
        testWorkspace.state
      );

      const originalAccessTime = workspace.last_accessed;
      
      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      await bridge.touchWorkspace(testWorkspace.name);

      const touched = await bridge.getWorkspace(testWorkspace.name);
      expect(touched.last_accessed).toBeGreaterThan(originalAccessTime);
    });

    it('should get workspace names through bridge', async () => {
      await bridge.createWorkspace('Workspace 1', '/path1', {});
      await bridge.createWorkspace('Workspace 2', '/path2', {});

      const names = await bridge.getWorkspaceNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('Workspace 1');
      expect(names).toContain('Workspace 2');
    });
  });

  describe('Atomic Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should perform atomic workspace update through bridge', async () => {
      await bridge.createWorkspace('Atomic Test', '/original', {
        setting1: 'value1'
      });

      const updates = {
        state: { setting1: 'updated', setting2: 'new' },
        folderPath: '/updated'
      };

      const updated = await bridge.updateWorkspaceAtomic('Atomic Test', updates);

      expect(updated.folderPath).toBe('/updated');
      expect(updated.state.setting1).toBe('updated');
      expect(updated.state.setting2).toBe('new');
    });

    it('should perform atomic workspace rename through bridge', async () => {
      await bridge.createWorkspace('Original', '/path', { setting: 'value' });

      const renamed = await bridge.renameWorkspaceAtomic('Original', 'New Name');

      expect(renamed.name).toBe('New Name');
      expect(renamed.state.setting).toBe('value');

      const original = await bridge.getWorkspace('Original');
      expect(original).toBeNull();
    });
  });

  describe('Preference Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should get and set preferences through bridge', async () => {
      const key = 'test-pref';
      const value = { setting: 'value', enabled: true };

      await bridge.setPreference(key, value);
      const retrieved = await bridge.getPreference(key);

      expect(retrieved).toEqual(value);
    });

    it('should handle different preference data types', async () => {
      const tests = [
        { key: 'string-pref', value: 'string value' },
        { key: 'number-pref', value: 42 },
        { key: 'boolean-pref', value: true },
        { key: 'array-pref', value: ['a', 'b', 'c'] },
        { key: 'object-pref', value: { nested: { deep: 'value' } } }
      ];

      for (const test of tests) {
        await bridge.setPreference(test.key, test.value);
        const retrieved = await bridge.getPreference(test.key);
        expect(retrieved).toEqual(test.value);
      }
    });

    it('should return null for non-existent preferences', async () => {
      const result = await bridge.getPreference('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle operations on uninitialized bridge gracefully', async () => {
      const uninitializedBridge = new DatabaseBridge();

      // These should not throw but may return undefined/null
      await expect(uninitializedBridge.listWorkspaces()).rejects.toThrow();
    });

    it('should handle concurrent initialization attempts', async () => {
      const promises = [
        bridge.initialize(),
        bridge.initialize(),
        bridge.initialize()
      ];

      await Promise.all(promises);

      expect(bridge.initialized).toBe(true);
      expect(bridge.db).toBeDefined();
    });
  });

  describe('Performance and Reliability', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should handle multiple rapid operations without issues', async () => {
      const operations = [];

      // Create multiple workspaces concurrently
      for (let i = 0; i < 10; i++) {
        operations.push(
          bridge.createWorkspace(`Workspace ${i}`, `/path${i}`, { index: i })
        );
      }

      const workspaces = await Promise.all(operations);

      expect(workspaces).toHaveLength(10);
      workspaces.forEach((workspace, index) => {
        expect(workspace.name).toBe(`Workspace ${index}`);
        expect(workspace.state.index).toBe(index);
      });

      // Verify all workspaces were created
      const allWorkspaces = await bridge.listWorkspaces();
      expect(allWorkspaces).toHaveLength(10);
    });

    it('should handle large state objects efficiently', async () => {
      const largeState = {
        selectedFiles: Array.from({ length: 1000 }, (_, i) => `file${i}.txt`),
        expandedNodes: {},
        metadata: {}
      };

      // Add large nested structures
      for (let i = 0; i < 100; i++) {
        largeState.expandedNodes[`/path${i}`] = true;
        largeState.metadata[`key${i}`] = {
          description: 'Large description '.repeat(50),
          values: Array.from({ length: 20 }, (_, j) => `value${i}-${j}`)
        };
      }

      const startTime = Date.now();
      const workspace = await bridge.createWorkspace('Large State', '/large', largeState);
      const createTime = Date.now() - startTime;

      const retrieveStart = Date.now();
      const retrieved = await bridge.getWorkspace('Large State');
      const retrieveTime = Date.now() - retrieveStart;

      expect(retrieved.state.selectedFiles).toHaveLength(1000);
      expect(Object.keys(retrieved.state.metadata)).toHaveLength(100);
      expect(createTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(retrieveTime).toBeLessThan(500); // Should retrieve in under 0.5 seconds
    });
  });

  describe('Database Cleanup', () => {
    it('should close database properly', async () => {
      await bridge.initialize();
      expect(bridge.db).toBeDefined();

      await bridge.close();
      expect(bridge.db).toBeNull();
    });

    it('should handle multiple close calls gracefully', async () => {
      await bridge.initialize();
      
      await bridge.close();
      await bridge.close();
      await bridge.close();

      expect(bridge.db).toBeNull();
    });

    it('should handle close on uninitialized bridge', async () => {
      const uninitializedBridge = new DatabaseBridge();
      
      await expect(uninitializedBridge.close()).resolves.not.toThrow();
    });
  });
});