import Database from 'better-sqlite3';
import { PasteFlowDatabase } from '../database-implementation';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PasteFlowDatabase', () => {
  let db: PasteFlowDatabase;
  let tempDbPath: string;

  beforeEach(async () => {
    // Use in-memory database for testing to avoid Node.js version issues
    tempDbPath = ':memory:';
    db = new PasteFlowDatabase(tempDbPath);
    await db.initializeDatabase();
  });

  afterEach(() => {
    // Clean up database after each test
    if (db) {
      db.close();
    }
    // No need to clean up in-memory databases
  });

  describe('Database Initialization', () => {
    it('should create all required tables and indexes', () => {
      // Test table creation by attempting to query each table
      const workspacesCount = db.db.prepare('SELECT COUNT(*) as count FROM workspaces').get();
      const preferencesCount = db.db.prepare('SELECT COUNT(*) as count FROM preferences').get();
      const customPromptsCount = db.db.prepare('SELECT COUNT(*) as count FROM custom_prompts').get();

      expect(workspacesCount.count).toBe(0);
      expect(preferencesCount.count).toBe(0);
      expect(customPromptsCount.count).toBe(0);
    });

    it('should set performance optimizations correctly', () => {
      const journalMode = db.db.pragma('journal_mode', { simple: true });
      const synchronous = db.db.pragma('synchronous', { simple: true });
      const tempStore = db.db.pragma('temp_store', { simple: true });

      expect(journalMode).toBe('wal');
      expect(synchronous).toBe(1); // NORMAL = 1
      expect(tempStore).toBe(2); // MEMORY = 2
    });
  });

  describe('Workspace CRUD Operations', () => {
    const testWorkspaceData = {
      name: 'Test Workspace',
      folderPath: '/test/path',
      state: {
        selectedFiles: ['file1.txt', 'file2.txt'],
        expandedNodes: { '/test': true },
        selectedFolder: '/test/path'
      }
    };

    it('should create a new workspace successfully', () => {
      const workspace = db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      expect(workspace).toBeDefined();
      expect(workspace.name).toBe(testWorkspaceData.name);
      expect(workspace.folderPath).toBe(testWorkspaceData.folderPath);
      expect(workspace.state).toEqual(testWorkspaceData.state);
      expect(workspace.id).toBeDefined();
      expect(workspace.created_at).toBeDefined();
      expect(workspace.updated_at).toBeDefined();
    });

    it('should retrieve a workspace by name', () => {
      db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const retrieved = db.getWorkspace(testWorkspaceData.name);

      expect(retrieved).toBeDefined();
      expect(retrieved.name).toBe(testWorkspaceData.name);
      expect(retrieved.state).toEqual(testWorkspaceData.state);
    });

    it('should retrieve a workspace by ID', () => {
      const created = db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const retrieved = db.getWorkspace(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe(testWorkspaceData.name);
    });

    it('should return null for non-existent workspace', () => {
      const result = db.getWorkspace('Non-existent Workspace');
      expect(result).toBeNull();
    });

    it('should update workspace state', () => {
      db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const newState = {
        selectedFiles: ['file3.txt'],
        expandedNodes: { '/new': true },
        selectedFolder: '/new/path'
      };

      db.updateWorkspace(testWorkspaceData.name, newState);
      const updated = db.getWorkspace(testWorkspaceData.name);

      expect(updated.state).toEqual(newState);
      expect(updated.updated_at).toBeGreaterThan(updated.created_at);
    });

    it('should delete workspace successfully', () => {
      db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      db.deleteWorkspace(testWorkspaceData.name);
      const retrieved = db.getWorkspace(testWorkspaceData.name);

      expect(retrieved).toBeNull();
    });

    it('should rename workspace successfully', () => {
      db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const newName = 'Renamed Workspace';
      db.renameWorkspace(testWorkspaceData.name, newName);

      const oldWorkspace = db.getWorkspace(testWorkspaceData.name);
      const newWorkspace = db.getWorkspace(newName);

      expect(oldWorkspace).toBeNull();
      expect(newWorkspace).toBeDefined();
      expect(newWorkspace.name).toBe(newName);
      expect(newWorkspace.state).toEqual(testWorkspaceData.state);
    });

    it('should update last accessed time when touching workspace', () => {
      const workspace = db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const originalAccessTime = workspace.last_accessed;
      
      // Wait a small amount to ensure timestamp difference
      setTimeout(() => {
        db.touchWorkspace(testWorkspaceData.name);
        const touched = db.getWorkspace(testWorkspaceData.name);

        expect(touched.last_accessed).toBeGreaterThan(originalAccessTime);
      }, 10);
    });

    it('should list workspaces ordered by last accessed', () => {
      const workspace1 = db.createWorkspace('Workspace 1', '/path1', {});
      const workspace2 = db.createWorkspace('Workspace 2', '/path2', {});
      
      // Touch workspace1 to make it more recently accessed
      db.touchWorkspace('Workspace 1');
      
      const workspaces = db.listWorkspaces();

      expect(workspaces).toHaveLength(2);
      expect(workspaces[0].name).toBe('Workspace 1'); // Most recently accessed first
      expect(workspaces[1].name).toBe('Workspace 2');
    });

    it('should get workspace names efficiently', () => {
      db.createWorkspace('Alpha Workspace', '/alpha', {});
      db.createWorkspace('Beta Workspace', '/beta', {});

      const names = db.getWorkspaceNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('Alpha Workspace');
      expect(names).toContain('Beta Workspace');
    });
  });

  describe('Preference Operations', () => {
    it('should store and retrieve string preferences', () => {
      const key = 'test-string-pref';
      const value = 'test-value';

      db.setPreference(key, value);
      const retrieved = db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should store and retrieve object preferences', () => {
      const key = 'test-object-pref';
      const value = { setting1: true, setting2: 42, setting3: 'nested' };

      db.setPreference(key, value);
      const retrieved = db.getPreference(key);

      expect(retrieved).toEqual(value);
    });

    it('should store and retrieve array preferences', () => {
      const key = 'test-array-pref';
      const value = ['item1', 'item2', 'item3'];

      db.setPreference(key, value);
      const retrieved = db.getPreference(key);

      expect(retrieved).toEqual(value);
    });

    it('should store and retrieve boolean preferences', () => {
      const key = 'test-boolean-pref';
      const value = true;

      db.setPreference(key, value);
      const retrieved = db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should store and retrieve number preferences', () => {
      const key = 'test-number-pref';
      const value = 42.5;

      db.setPreference(key, value);
      const retrieved = db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should return null for non-existent preferences', () => {
      const result = db.getPreference('non-existent-key');
      expect(result).toBeNull();
    });

    it('should update existing preferences', () => {
      const key = 'update-test';
      const originalValue = 'original';
      const updatedValue = 'updated';

      db.setPreference(key, originalValue);
      db.setPreference(key, updatedValue);
      const retrieved = db.getPreference(key);

      expect(retrieved).toBe(updatedValue);
    });

    it('should handle malformed JSON gracefully', () => {
      const key = 'malformed-json-test';
      
      // Directly insert malformed JSON to test error handling
      db.statements.setPreference.run(key, '{"invalid": json}');
      const retrieved = db.getPreference(key);

      // Should return the raw value when JSON parsing fails
      expect(retrieved).toBe('{"invalid": json}');
    });

    it('should handle null and empty values correctly', () => {
      const nullKey = 'null-test';
      const emptyKey = 'empty-test';

      db.setPreference(nullKey, null);
      db.setPreference(emptyKey, '');

      expect(db.getPreference(nullKey)).toBeNull();
      expect(db.getPreference(emptyKey)).toBeNull();
    });
  });

  describe('Transaction Support', () => {
    it('should execute successful transactions', () => {
      const result = db.runInTransaction(() => {
        db.createWorkspace('TX Workspace 1', '/tx1', {});
        db.createWorkspace('TX Workspace 2', '/tx2', {});
        return 'success';
      });

      expect(result).toBe('success');
      expect(db.getWorkspace('TX Workspace 1')).toBeDefined();
      expect(db.getWorkspace('TX Workspace 2')).toBeDefined();
    });

    it('should rollback failed transactions', () => {
      expect(() => {
        db.runInTransaction(() => {
          db.createWorkspace('TX Workspace 1', '/tx1', {});
          // This should cause an error due to duplicate name
          db.createWorkspace('TX Workspace 1', '/tx1', {});
        });
      }).toThrow();

      // Neither workspace should exist due to rollback
      expect(db.getWorkspace('TX Workspace 1')).toBeNull();
    });

    it('should perform atomic workspace updates', () => {
      const originalWorkspace = db.createWorkspace('Atomic Test', '/original', {
        setting1: 'value1'
      });

      const updates = {
        state: { setting1: 'updated', setting2: 'new' },
        folderPath: '/updated'
      };

      const updatedWorkspace = db.updateWorkspaceAtomic('Atomic Test', updates);

      expect(updatedWorkspace.folderPath).toBe('/updated');
      expect(updatedWorkspace.state.setting1).toBe('updated');
      expect(updatedWorkspace.state.setting2).toBe('new');
      expect(updatedWorkspace.last_accessed).toBeGreaterThan(originalWorkspace.last_accessed);
    });

    it('should throw error for atomic update of non-existent workspace', () => {
      expect(() => {
        db.updateWorkspaceAtomic('Non-existent', { state: {} });
      }).toThrow("Workspace 'Non-existent' not found");
    });

    it('should perform atomic workspace rename', () => {
      db.createWorkspace('Original Name', '/path', { setting: 'value' });

      const renamedWorkspace = db.renameWorkspaceAtomic('Original Name', 'New Name');

      expect(renamedWorkspace.name).toBe('New Name');
      expect(renamedWorkspace.state.setting).toBe('value');
      expect(db.getWorkspace('Original Name')).toBeNull();
    });

    it('should throw error when renaming to existing workspace name', () => {
      db.createWorkspace('Workspace 1', '/path1', {});
      db.createWorkspace('Workspace 2', '/path2', {});

      expect(() => {
        db.renameWorkspaceAtomic('Workspace 1', 'Workspace 2');
      }).toThrow("Workspace 'Workspace 2' already exists");
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle workspace creation with empty state', () => {
      const workspace = db.createWorkspace('Empty State', '/path', {});

      expect(workspace.state).toEqual({});
    });

    it('should handle workspace creation with undefined state', () => {
      const workspace = db.createWorkspace('Undefined State', '/path');

      expect(workspace.state).toEqual({});
    });

    it('should handle complex nested state objects', () => {
      const complexState = {
        selectedFiles: ['file1.txt', 'file2.txt'],
        fileTree: {
          '/src': {
            expanded: true,
            children: ['file1.txt', 'file2.txt']
          }
        },
        settings: {
          theme: 'dark',
          fontSize: 14,
          features: {
            autoSave: true,
            linting: false
          }
        }
      };

      const workspace = db.createWorkspace('Complex State', '/complex', complexState);
      const retrieved = db.getWorkspace('Complex State');

      expect(retrieved.state).toEqual(complexState);
    });

    it('should handle very large state objects', () => {
      // Create a large state object to test JSON serialization limits
      const largeState = {
        selectedFiles: Array.from({ length: 1000 }, (_, i) => `file${i}.txt`),
        metadata: {}
      };

      // Add a large nested object
      for (let i = 0; i < 100; i++) {
        largeState.metadata[`key${i}`] = {
          description: `This is a description for key ${i}`.repeat(10),
          values: Array.from({ length: 50 }, (_, j) => `value${i}-${j}`)
        };
      }

      const workspace = db.createWorkspace('Large State', '/large', largeState);
      const retrieved = db.getWorkspace('Large State');

      expect(retrieved.state.selectedFiles).toHaveLength(1000);
      expect(Object.keys(retrieved.state.metadata)).toHaveLength(100);
    });

    it('should handle special characters in workspace names', () => {
      const specialName = 'Workspace with "quotes" & <symbols> [brackets] {braces}';
      const workspace = db.createWorkspace(specialName, '/special', {});

      const retrieved = db.getWorkspace(specialName);
      expect(retrieved.name).toBe(specialName);
    });

    it('should handle special characters in preference keys and values', () => {
      const specialKey = 'pref/with:special@chars#';
      const specialValue = 'Value with "quotes" & symbols! {complex: "json"}';

      db.setPreference(specialKey, specialValue);
      const retrieved = db.getPreference(specialKey);

      expect(retrieved).toBe(specialValue);
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle bulk workspace operations efficiently', () => {
      const startTime = Date.now();
      const workspaceCount = 100;

      // Create many workspaces
      for (let i = 0; i < workspaceCount; i++) {
        db.createWorkspace(`Workspace ${i}`, `/path${i}`, {
          index: i,
          files: Array.from({ length: 10 }, (_, j) => `file${j}.txt`)
        });
      }

      const createTime = Date.now() - startTime;

      // List all workspaces
      const listStart = Date.now();
      const workspaces = db.listWorkspaces();
      const listTime = Date.now() - listStart;

      expect(workspaces).toHaveLength(workspaceCount);
      expect(createTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(listTime).toBeLessThan(1000); // Should list in under 1 second
    });

    it('should handle bulk preference operations efficiently', () => {
      const startTime = Date.now();
      const prefCount = 1000;

      // Set many preferences
      for (let i = 0; i < prefCount; i++) {
        db.setPreference(`pref${i}`, {
          value: i,
          name: `Preference ${i}`,
          active: i % 2 === 0
        });
      }

      const setTime = Date.now() - startTime;

      // Get many preferences
      const getStart = Date.now();
      for (let i = 0; i < prefCount; i++) {
        const pref = db.getPreference(`pref${i}`);
        expect(pref.value).toBe(i);
      }
      const getTime = Date.now() - getStart;

      expect(setTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(getTime).toBeLessThan(3000); // Should retrieve in under 3 seconds
    });
  });

  describe('Database Cleanup', () => {
    it('should close database connection properly', () => {
      expect(() => {
        db.close();
      }).not.toThrow();

      // Verify database is closed by attempting an operation
      expect(() => {
        db.getWorkspace('test');
      }).toThrow();
    });
  });
});