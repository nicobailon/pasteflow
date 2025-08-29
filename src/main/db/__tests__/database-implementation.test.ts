import { PasteFlowDatabase, WorkspaceState as DBWorkspaceState } from '../database-implementation';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('PasteFlowDatabase', () => {
  let db: PasteFlowDatabase;

  beforeEach(async () => {
    // Use in-memory database for testing
    db = new PasteFlowDatabase(':memory:');
    await db.initializeDatabase();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Database Initialization', () => {
    it('should create all required tables and indexes', () => {
      const raw = db.db!;
      const workspacesCount = raw.prepare('SELECT COUNT(*) as count FROM workspaces').get() as { count: number };
      const preferencesCount = raw.prepare('SELECT COUNT(*) as count FROM preferences').get() as { count: number };
      const instructionsCount = raw.prepare('SELECT COUNT(*) as count FROM instructions').get() as { count: number };

      expect(workspacesCount.count).toBe(0);
      expect(preferencesCount.count).toBe(0);
      expect(instructionsCount.count).toBe(0);
    });

    it('should set performance optimizations correctly', () => {
      const raw = db.db!;
      const journalMode = raw.pragma('journal_mode', { simple: true }) as string;
      const synchronous = raw.pragma('synchronous', { simple: true }) as number;
      const tempStore = raw.pragma('temp_store', { simple: true }) as number;

      expect(journalMode.toLowerCase()).toBe('wal');
      expect(synchronous).toBe(1); // NORMAL = 1
      expect(tempStore).toBe(2); // MEMORY = 2
    });
  });

  describe('Workspace CRUD Operations', () => {
    const mkState = (): DBWorkspaceState => ({
      selectedFiles: [{ path: 'file1.txt' }, { path: 'file2.txt' }],
      expandedNodes: { '/test': true },
      userInstructions: 'Test instructions',
      systemPrompts: [{ id: 's1', name: 'Sys', content: 'sys content' }],
      rolePrompts: [{ id: 'r1', name: 'Role', content: 'role content' }]
    });

    const testWorkspaceData = {
      name: 'Test Workspace',
      folderPath: '/test/path',
      state: mkState()
    };

    it('should create a new workspace successfully', async () => {
      const workspace = await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      expect(workspace).toBeDefined();
      expect(workspace.name).toBe(testWorkspaceData.name);
      expect(workspace.folder_path).toBe(testWorkspaceData.folderPath);
      expect(workspace.state).toEqual(testWorkspaceData.state);
      expect(workspace.id).toBeDefined();
      expect(workspace.created_at).toBeDefined();
      expect(workspace.updated_at).toBeDefined();
    });

    it('should retrieve a workspace by name', async () => {
      await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const retrieved = await db.getWorkspace(testWorkspaceData.name);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(testWorkspaceData.name);
      expect(retrieved!.state).toEqual(testWorkspaceData.state);
    });

    it('should retrieve a workspace by ID', async () => {
      const created = await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const retrieved = await db.getWorkspace(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe(testWorkspaceData.name);
    });

    it('should return null for non-existent workspace', async () => {
      const result = await db.getWorkspace('Non-existent Workspace');
      expect(result).toBeNull();
    });

    it('should update workspace state (by name)', async () => {
      await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const newState: DBWorkspaceState = {
        selectedFiles: [{ path: 'file3.txt' }],
        expandedNodes: { '/new': true },
        userInstructions: 'Updated',
        systemPrompts: [],
        rolePrompts: []
      };

      await db.updateWorkspace(testWorkspaceData.name, newState);
      const updated = await db.getWorkspace(testWorkspaceData.name);

      expect(updated!.state).toEqual(newState);
      expect(updated!.updated_at).toBeGreaterThan(updated!.created_at);
    });

    it('should update workspace state by ID', async () => {
      const created = await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const newState: DBWorkspaceState = {
        selectedFiles: [{ path: 'fileX.txt' }],
        expandedNodes: { '/changed': true },
        userInstructions: 'ById',
        systemPrompts: [],
        rolePrompts: []
      };

      await db.updateWorkspaceById(created.id, newState);
      const updated = await db.getWorkspace(created.id);

      expect(updated!.state).toEqual(newState);
    });

it('should throw when updating by non-existent ID', async () => {
      await expect(db.updateWorkspaceById(999_999, {
        selectedFiles: [],
        systemPrompts: [],
        rolePrompts: []
      } as Partial<DBWorkspaceState>)).rejects.toThrow("Workspace with id '999999' not found");
    });
    it('should delete workspace successfully', async () => {
      await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      await db.deleteWorkspace(testWorkspaceData.name);
      const retrieved = await db.getWorkspace(testWorkspaceData.name);

      expect(retrieved).toBeNull();
    });

    it('should rename workspace successfully', async () => {
      await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const newName = 'Renamed Workspace';
      await db.renameWorkspace(testWorkspaceData.name, newName);

      const oldWorkspace = await db.getWorkspace(testWorkspaceData.name);
      const newWorkspace = await db.getWorkspace(newName);

      expect(oldWorkspace).toBeNull();
      expect(newWorkspace).toBeDefined();
      expect(newWorkspace!.name).toBe(newName);
      expect(newWorkspace!.state).toEqual(testWorkspaceData.state);
    });

    it('should update last accessed time when touching workspace', async () => {
      const workspace = await db.createWorkspace(
        testWorkspaceData.name,
        testWorkspaceData.folderPath,
        testWorkspaceData.state
      );

      const originalAccessTime = workspace.last_accessed;

      await delay(10);
      await db.touchWorkspace(testWorkspaceData.name);
      const touched = await db.getWorkspace(testWorkspaceData.name);

      expect(touched!.last_accessed).toBeGreaterThan(originalAccessTime);
    });

    it('should list workspaces ordered by last accessed', async () => {
      await db.createWorkspace('Workspace 1', '/path1', {});
      await db.createWorkspace('Workspace 2', '/path2', {});
      await db.touchWorkspace('Workspace 1');

      const workspaces = await db.listWorkspaces();

      expect(workspaces.length).toBe(2);
      expect(workspaces[0].name).toBe('Workspace 1');
      expect(workspaces[1].name).toBe('Workspace 2');
    });

    it('should get workspace names efficiently', async () => {
      await db.createWorkspace('Alpha Workspace', '/alpha', {});
      await db.createWorkspace('Beta Workspace', '/beta', {});

      const names = await db.getWorkspaceNames();

      expect(names.length).toBe(2);
      expect(names).toContain('Alpha Workspace');
      expect(names).toContain('Beta Workspace');
    });
  });

  describe('Preference Operations', () => {
    it('should store and retrieve string preferences', async () => {
      const key = 'test-string-pref';
      const value = 'test-value';

      await db.setPreference(key, value);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should store and retrieve object preferences', async () => {
      const key = 'test-object-pref';
      const value = { setting1: true, setting2: 42, setting3: 'nested' };

      await db.setPreference(key, value);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toEqual(value);
    });

    it('should store and retrieve array preferences', async () => {
      const key = 'test-array-pref';
      const value = ['item1', 'item2', 'item3'];

      await db.setPreference(key, value);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toEqual(value);
    });

    it('should store and retrieve boolean preferences', async () => {
      const key = 'test-boolean-pref';
      const value = true;

      await db.setPreference(key, value);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should store and retrieve number preferences', async () => {
      const key = 'test-number-pref';
      const value = 42.5;

      await db.setPreference(key, value);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toBe(value);
    });

    it('should return null for non-existent preferences', async () => {
      const result = await db.getPreference('non-existent-key');
      expect(result).toBeNull();
    });

    it('should update existing preferences', async () => {
      const key = 'update-test';
      const originalValue = 'original';
      const updatedValue = 'updated';

      await db.setPreference(key, originalValue);
      await db.setPreference(key, updatedValue);
      const retrieved = await db.getPreference(key);

      expect(retrieved).toBe(updatedValue);
    });

    it('should handle malformed JSON gracefully', async () => {
      const key = 'malformed-json-test';

      // Directly insert malformed JSON using raw handle
      const raw = db.db!;
      raw.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run(key, '{"invalid": json}');
      const retrieved = await db.getPreference(key);

      // Should return the raw value when JSON parsing fails
      expect(retrieved).toBe('{"invalid": json}');
    });

    it('should handle null and empty values correctly', async () => {
      const nullKey = 'null-test';
      const emptyKey = 'empty-test';

      await db.setPreference(nullKey, null);
      await db.setPreference(emptyKey, '');

      expect(await db.getPreference(nullKey)).toBeNull();
      expect(await db.getPreference(emptyKey)).toBeNull();
    });
  });

  describe('Atomic Operations', () => {
    it('should perform atomic workspace updates', async () => {
      const originalWorkspace = await db.createWorkspace('Atomic Test', '/original', {
        setting1: 'value1'
      } as unknown as DBWorkspaceState);

      const updates = {
        state: { setting1: 'updated', setting2: 'new' } as Partial<DBWorkspaceState>,
        folderPath: '/updated'
      };

      const updatedWorkspace = await db.updateWorkspaceAtomic('Atomic Test', updates);

      expect(updatedWorkspace.folder_path).toBe('/updated');
      expect((updatedWorkspace.state as any).setting1).toBe('updated');
      expect((updatedWorkspace.state as any).setting2).toBe('new');
      expect(updatedWorkspace.last_accessed).toBeGreaterThan(originalWorkspace.last_accessed);
    });

    it('should throw error for atomic update of non-existent workspace', async () => {
      await expect(db.updateWorkspaceAtomic('Non-existent', { state: {} })).rejects.toThrow("Workspace 'Non-existent' not found");
    });

    it('should perform atomic workspace rename', async () => {
      await db.createWorkspace('Original Name', '/path', { setting: 'value' } as unknown as DBWorkspaceState);

      const renamedWorkspace = await db.renameWorkspaceAtomic('Original Name', 'New Name');

      expect(renamedWorkspace.name).toBe('New Name');
      expect((renamedWorkspace.state as any).setting).toBe('value');
      expect(await db.getWorkspace('Original Name')).toBeNull();
    });

    it('should throw error when renaming to existing workspace name', async () => {
      await db.createWorkspace('Workspace 1', '/path1', {});
      await db.createWorkspace('Workspace 2', '/path2', {});

      await expect(db.renameWorkspaceAtomic('Workspace 1', 'Workspace 2')).rejects.toThrow("Workspace 'Workspace 2' already exists");
    });
  });

  describe('Database Cleanup', () => {
    it('should close database connection properly', async () => {
      expect(() => {
        db.close();
      }).not.toThrow();

      // Verify database is closed by attempting an operation
      await expect(db.getWorkspace('test')).rejects.toThrow();
    });
  });
});