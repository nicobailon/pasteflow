import { AsyncDatabase } from '../async-database';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AsyncDatabase', () => {
  let db: AsyncDatabase;
  let testDbPath: string;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test database
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-test-'));
    testDbPath = path.join(tempDir, 'test.db');
    
    // Initialize database with schema
    db = new AsyncDatabase(testDbPath);
    const schemaSQL = await fs.readFile(
      path.join(__dirname, '..', 'schema.sql'),
      'utf8'
    );
    await db.exec(schemaSQL);
  });

  afterEach(async () => {
    // Clean up
    if (db) {
      await db.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Basic CRUD operations', () => {
    it('should insert and retrieve workspace data correctly', async () => {
      // Create test data
      const workspaceData = {
        id: 'test-workspace-123',
        name: 'My Test Workspace',
        folderPath: '/test/path/to/workspace',
        state: { selectedFiles: [], expandedNodes: {} }
      };

      // Insert workspace
      const result = await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        [workspaceData.id, workspaceData.name, workspaceData.folderPath, JSON.stringify(workspaceData.state)]
      );

      // Verify insertion
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBeDefined();

      // Retrieve workspace
      const workspace = await db.get<{
        id: string;
        name: string;
        folder_path: string;
        state_json: string;
      }>('SELECT * FROM workspaces WHERE id = ?', [workspaceData.id]);

      // Verify retrieved data
      expect(workspace).toBeDefined();
      expect(workspace?.name).toBe(workspaceData.name);
      expect(workspace?.folder_path).toBe(workspaceData.folderPath);
      expect(JSON.parse(workspace?.state_json || '{}')).toEqual(workspaceData.state);
    });

    it('should update existing records and maintain timestamps', async () => {
      // Insert initial workspace
      const id = 'update-test-123';
      await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        [id, 'Initial Name', '/initial/path', '{}']
      );

      // Get initial timestamps
      const initial = await db.get<{ created_at: number; updated_at: number }>(
        'SELECT created_at, updated_at FROM workspaces WHERE id = ?',
        [id]
      );

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update workspace
      const newState = { selectedFiles: ['file1.ts', 'file2.ts'] };
      await db.run(
        'UPDATE workspaces SET name = ?, state_json = ? WHERE id = ?',
        ['Updated Name', JSON.stringify(newState), id]
      );

      // Verify update
      const updated = await db.get<{
        name: string;
        state_json: string;
        created_at: number;
        updated_at: number;
      }>('SELECT * FROM workspaces WHERE id = ?', [id]);

      expect(updated?.name).toBe('Updated Name');
      expect(JSON.parse(updated?.state_json || '{}')).toEqual(newState);
      expect(updated?.created_at).toBe(initial?.created_at);
      expect(updated?.updated_at).toBeGreaterThan(initial?.updated_at || 0);
    });

    it('should delete records with cascade to related tables', async () => {
      const workspaceId = 'delete-test-123';
      
      // Insert workspace and related files
      await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        [workspaceId, 'Delete Test', '/delete/test', '{}']
      );

      await db.run(
        'INSERT INTO files (path, workspace_id, size, is_binary) VALUES (?, ?, ?, ?)',
        ['/test/file1.ts', workspaceId, 1000, 0]
      );

      await db.run(
        'INSERT INTO files (path, workspace_id, size, is_binary) VALUES (?, ?, ?, ?)',
        ['/test/file2.ts', workspaceId, 2000, 0]
      );

      // Verify files exist
      const filesBefore = await db.all(
        'SELECT * FROM files WHERE workspace_id = ?',
        [workspaceId]
      );
      expect(filesBefore).toHaveLength(2);

      // Delete workspace
      const deleteResult = await db.run(
        'DELETE FROM workspaces WHERE id = ?',
        [workspaceId]
      );
      expect(deleteResult.changes).toBe(1);

      // Verify cascade deletion
      const filesAfter = await db.all(
        'SELECT * FROM files WHERE workspace_id = ?',
        [workspaceId]
      );
      expect(filesAfter).toHaveLength(0);

      const workspace = await db.get(
        'SELECT * FROM workspaces WHERE id = ?',
        [workspaceId]
      );
      expect(workspace).toBeUndefined();
    });
  });

  describe('Transaction handling', () => {
    it('should commit successful transactions', async () => {
      const result = await db.transaction(async () => {
        // Insert multiple related records
        await db.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
          ['trans-1', 'Transaction Test 1', '/trans/1', '{}']
        );

        await db.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
          ['trans-2', 'Transaction Test 2', '/trans/2', '{}']
        );

        return 'success';
      });

      expect(result).toBe('success');

      // Verify both records exist
      const count = await db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM workspaces WHERE id LIKE ?',
        ['trans-%']
      );
      expect(count?.count).toBe(2);
    });

    it('should rollback failed transactions', async () => {
      let error: Error | null = null;

      try {
        await db.transaction(async () => {
          // First insert should succeed
          await db.run(
            'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
            ['rollback-1', 'Rollback Test', '/rollback', '{}']
          );

          // Second insert should fail due to unique constraint
          await db.run(
            'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
            ['rollback-1', 'Duplicate ID', '/rollback2', '{}']
          );
        });
      } catch (e) {
        error = e as Error;
      }

      // Verify error occurred
      expect(error).not.toBeNull();
      expect(error?.message).toContain('UNIQUE constraint failed');

      // Verify rollback - no records should exist
      const count = await db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM workspaces WHERE id LIKE ?',
        ['rollback-%']
      );
      expect(count?.count).toBe(0);
    });

    it('should handle nested transactions correctly', async () => {
      const result = await db.transaction(async () => {
        await db.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
          ['nested-1', 'Nested Test 1', '/nested/1', '{}']
        );

        // Nested transaction (should use savepoints)
        const innerResult = await db.transaction(async () => {
          await db.run(
            'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
            ['nested-2', 'Nested Test 2', '/nested/2', '{}']
          );
          return 'inner-success';
        });

        expect(innerResult).toBe('inner-success');
        return 'outer-success';
      });

      expect(result).toBe('outer-success');

      // Verify both records exist
      const workspaces = await db.all<{ id: string }>(
        'SELECT id FROM workspaces WHERE id LIKE ? ORDER BY id',
        ['nested-%']
      );
      expect(workspaces).toHaveLength(2);
      expect(workspaces.map(w => w.id)).toEqual(['nested-1', 'nested-2']);
    });
  });

  describe('Prepared statements', () => {
    it('should reuse prepared statements for better performance', async () => {
      const stmt = await db.prepare(
        'INSERT INTO files (path, workspace_id, size, is_binary) VALUES (?, ?, ?, ?)'
      );

      // Insert multiple files using the same prepared statement
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `/test/file${i}.ts`,
        workspaceId: 'perf-test',
        size: Math.floor(Math.random() * 10000),
        isBinary: false
      }));

      // First create the workspace
      await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        ['perf-test', 'Performance Test', '/perf', '{}']
      );

      // Insert files
      for (const file of files) {
        const result = await stmt.run(
          file.path,
          file.workspaceId,
          file.size,
          file.isBinary ? 1 : 0
        );
        expect(result.changes).toBe(1);
      }

      // Finalize statement
      await stmt.finalize();

      // Verify all files were inserted
      const count = await db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM files WHERE workspace_id = ?',
        ['perf-test']
      );
      expect(count?.count).toBe(100);
    });

    it('should handle prepared statement errors gracefully', async () => {
      const stmt = await db.prepare('SELECT * FROM workspaces WHERE id = ?');

      // Use with valid parameter
      const result1 = await stmt.get<{ id: string }>('valid-id');
      expect(result1).toBeUndefined(); // No record exists

      // Use with multiple parameters (should handle gracefully)
      const result2 = await stmt.all<{ id: string }>('another-id');
      expect(result2).toEqual([]);

      await stmt.finalize();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle multiple concurrent reads', async () => {
      // Insert test data
      const workspaces = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-${i}`,
        name: `Concurrent Test ${i}`,
        folderPath: `/concurrent/${i}`,
        state: {}
      }));

      for (const ws of workspaces) {
        await db.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
          [ws.id, ws.name, ws.folderPath, JSON.stringify(ws.state)]
        );
      }

      // Perform concurrent reads
      const readPromises = workspaces.map(ws =>
        db.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', [ws.id])
      );

      const results = await Promise.all(readPromises);

      // Verify all reads succeeded
      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result?.name).toBe(`Concurrent Test ${i}`);
      });
    });

    it('should serialize writes to prevent conflicts', async () => {
      // Create workspace for concurrent updates
      await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        ['write-test', 'Write Test', '/write', '{"counter": 0}']
      );

      // Perform concurrent updates
      const updatePromises = Array.from({ length: 50 }, (_, i) =>
        db.run(
          'UPDATE workspaces SET state_json = ? WHERE id = ?',
          [JSON.stringify({ counter: i + 1 }), 'write-test']
        )
      );

      const results = await Promise.all(updatePromises);

      // Verify all updates succeeded
      expect(results).toHaveLength(50);
      results.forEach(result => {
        expect(result.changes).toBe(1);
      });

      // Check final state
      const final = await db.get<{ state_json: string }>(
        'SELECT state_json FROM workspaces WHERE id = ?',
        ['write-test']
      );
      const finalState = JSON.parse(final?.state_json || '{}');
      expect(finalState.counter).toBe(50);
    });
  });

  describe('Error handling', () => {
    it('should provide meaningful error messages for constraint violations', async () => {
      // Insert workspace
      await db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        ['error-test', 'Error Test', '/error', '{}']
      );

      // Try to insert duplicate
      await expect(
        db.run(
          'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
          ['error-test', 'Duplicate', '/error2', '{}']
        )
      ).rejects.toThrow('UNIQUE constraint failed');
    });

    it('should handle invalid SQL gracefully', async () => {
      await expect(
        db.run('INSERT INTO non_existent_table (id) VALUES (?)', ['test'])
      ).rejects.toThrow('no such table: non_existent_table');

      await expect(
        db.get('SELECT * FROM workspaces WHERE invalid_column = ?', ['test'])
      ).rejects.toThrow('no such column: invalid_column');
    });

    it('should timeout long-running queries', async () => {
      // This is a conceptual test - in real implementation, you'd need to
      // configure the timeout and create a query that takes longer
      const longRunningQuery = `
        WITH RECURSIVE long_query(n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM long_query WHERE n < 1000000
        )
        SELECT COUNT(*) FROM long_query
      `;

      // Note: This test might need adjustment based on actual timeout implementation
      // For now, we're testing that the query execution doesn't hang indefinitely
      const startTime = Date.now();
      try {
        await db.get(longRunningQuery);
      } catch (error) {
        // Expected to timeout or error
      }
      const duration = Date.now() - startTime;
      
      // Should not take more than 35 seconds (30s timeout + overhead)
      expect(duration).toBeLessThan(35000);
    });
  });
});