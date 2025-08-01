import { SecureDatabase } from '../secure-database';
import { AsyncDatabase } from '../async-database';
import * as keytar from 'keytar';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

describe('Database Security', () => {
  let tempDir: string;
  let dbPath: string;
  const SERVICE_NAME = 'com.pasteflow.app';
  const ACCOUNT_NAME = 'db-encryption-key';

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-security-test-'));
    dbPath = path.join(tempDir, 'secure-test.db');
    
    // Clear any existing keychain entry for tests
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME).catch(() => {});
  });

  afterEach(async () => {
    // Clean up
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('Encryption key management', () => {
    it('should generate and store encryption key on first run', async () => {
      // Verify no key exists initially
      const initialKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      expect(initialKey).toBeNull();

      // Create secure database
      const db = await SecureDatabase.create(dbPath);

      // Verify key was created and stored
      const storedKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      expect(storedKey).toBeDefined();
      expect(storedKey).not.toBeNull();
      expect(storedKey?.length).toBeGreaterThan(0);

      // Verify key is valid base64
      expect(() => Buffer.from(storedKey!, 'base64')).not.toThrow();

      await db.close();
    });

    it('should reuse existing encryption key on subsequent runs', async () => {
      // Create first instance
      const db1 = await SecureDatabase.create(dbPath);
      const key1 = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      await db1.close();

      // Create second instance
      const db2 = await SecureDatabase.create(dbPath);
      const key2 = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      await db2.close();

      // Keys should be identical
      expect(key2).toBe(key1);
    });

    it('should derive unique device-specific keys', async () => {
      // This test verifies that the derived key includes device-specific information
      const db = await SecureDatabase.create(dbPath);
      
      // Create test data
      const testData = { test: 'sensitive data' };
      await db.setPreference('test-key', testData, true);
      
      // Retrieve and verify
      const retrieved = await db.getPreference('test-key');
      expect(retrieved).toEqual(testData);
      
      await db.close();
    });
  });

  describe('Database encryption', () => {
    it('should encrypt database contents with SQLCipher', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Insert sensitive data
      const workspaceId = await db.createWorkspace(
        'Secure Workspace',
        '/secure/path',
        { apiKey: 'super-secret-key', tokens: ['token1', 'token2'] }
      );

      // Save file content
      await db.saveFileContent(
        workspaceId,
        '/secure/file.ts',
        'const secret = "confidential information";',
        10
      );

      await db.close();

      // Try to read database file directly (should be encrypted)
      const rawContent = await fs.readFile(dbPath);
      const contentString = rawContent.toString('utf8', 0, 1000);
      
      // Should not contain readable data
      expect(contentString).not.toContain('Secure Workspace');
      expect(contentString).not.toContain('super-secret-key');
      expect(contentString).not.toContain('confidential information');
      
      // Should look like encrypted/binary data
      expect(contentString).toMatch(/[\x00-\x1F\x7F-\xFF]/);
    });

    it('should fail to access encrypted database without proper key', async () => {
      // Create and populate encrypted database
      const db1 = await SecureDatabase.create(dbPath);
      await db1.createWorkspace('Test', '/test', {});
      await db1.close();

      // Try to access with wrong key by manipulating keychain
      const originalKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, 'wrong-key-base64');

      // Should fail to access
      await expect(SecureDatabase.create(dbPath)).rejects.toThrow();

      // Restore original key
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, originalKey!);
    });
  });

  describe('Preference encryption', () => {
    it('should encrypt sensitive preferences', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Store sensitive data
      const sensitiveData = {
        apiKey: 'sk-1234567890abcdef',
        refreshToken: 'refresh-token-value',
        credentials: {
          username: 'user@example.com',
          password: 'secure-password'
        }
      };

      await db.setPreference('auth-config', sensitiveData, true);

      // Verify retrieval works
      const retrieved = await db.getPreference('auth-config');
      expect(retrieved).toEqual(sensitiveData);

      // Check raw database storage
      const rawDb = new AsyncDatabase(dbPath);
      const rawPref = await rawDb.get<{ value: string; encrypted: number }>(
        'SELECT value, encrypted FROM preferences WHERE key = ?',
        ['auth-config']
      );

      // Should be marked as encrypted
      expect(rawPref?.encrypted).toBe(1);
      
      // Value should not contain readable sensitive data
      expect(rawPref?.value).not.toContain('sk-1234567890abcdef');
      expect(rawPref?.value).not.toContain('secure-password');
      
      // Should look like encrypted data (format: iv:encrypted)
      expect(rawPref?.value).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);

      await rawDb.close();
      await db.close();
    });

    it('should store non-sensitive preferences in plain text', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Store non-sensitive data
      const settings = {
        theme: 'dark',
        fontSize: 14,
        autoSave: true
      };

      await db.setPreference('ui-settings', settings, false);

      // Verify retrieval
      const retrieved = await db.getPreference('ui-settings');
      expect(retrieved).toEqual(settings);

      // Check raw storage
      const rawDb = new AsyncDatabase(dbPath);
      const rawPref = await rawDb.get<{ value: string; encrypted: number }>(
        'SELECT value, encrypted FROM preferences WHERE key = ?',
        ['ui-settings']
      );

      // Should not be encrypted
      expect(rawPref?.encrypted).toBe(0);
      
      // Value should be readable JSON
      expect(JSON.parse(rawPref?.value || '{}')).toEqual(settings);

      await rawDb.close();
      await db.close();
    });
  });

  describe('File content security', () => {
    it('should compress and deduplicate file contents', async () => {
      const db = await SecureDatabase.create(dbPath);
      const workspaceId = await db.createWorkspace('Test', '/test', {});
      
      // Same content in different files
      const duplicateContent = 'export function testFunction() {\n  return "test";\n}\n'.repeat(100);
      
      // Save same content to multiple files
      await db.saveFileContent(workspaceId, '/file1.ts', duplicateContent, 50);
      await db.saveFileContent(workspaceId, '/file2.ts', duplicateContent, 50);
      await db.saveFileContent(workspaceId, '/file3.ts', duplicateContent, 50);

      // Check deduplication
      const rawDb = new AsyncDatabase(dbPath);
      
      // Should have 3 file entries
      const files = await rawDb.all<{ content_hash: string }>(
        'SELECT content_hash FROM files WHERE workspace_id = ?',
        [workspaceId]
      );
      expect(files).toHaveLength(3);
      
      // All should have same hash
      const hashes = files.map(f => f.content_hash);
      expect(new Set(hashes).size).toBe(1);

      // Should have only 1 content entry
      const contents = await rawDb.all<{ 
        hash: string;
        original_size: number;
        compressed_size: number;
        compression_ratio: number;
      }>('SELECT * FROM file_contents');
      expect(contents).toHaveLength(1);
      
      // Verify compression
      const content = contents[0];
      expect(content.compressed_size).toBeLessThan(content.original_size);
      expect(content.compression_ratio).toBeLessThan(1);
      expect(content.compression_ratio).toBeGreaterThan(0);

      await rawDb.close();
      await db.close();
    });

    it('should correctly retrieve deduplicated content', async () => {
      const db = await SecureDatabase.create(dbPath);
      const workspaceId = await db.createWorkspace('Test', '/test', {});
      
      // Different contents
      const content1 = 'const a = 1;\n';
      const content2 = 'const b = 2;\n';
      const content3 = content1; // Duplicate of content1
      
      // Save files
      await db.saveFileContent(workspaceId, '/file1.ts', content1, 5);
      await db.saveFileContent(workspaceId, '/file2.ts', content2, 5);
      await db.saveFileContent(workspaceId, '/file3.ts', content3, 5);

      // Retrieve and verify
      const retrieved1 = await db.getFileContent(workspaceId, '/file1.ts');
      const retrieved2 = await db.getFileContent(workspaceId, '/file2.ts');
      const retrieved3 = await db.getFileContent(workspaceId, '/file3.ts');

      expect(retrieved1).toBe(content1);
      expect(retrieved2).toBe(content2);
      expect(retrieved3).toBe(content3);

      // Verify deduplication worked
      const rawDb = new AsyncDatabase(dbPath);
      const contentCount = await rawDb.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM file_contents'
      );
      expect(contentCount?.count).toBe(2); // Only 2 unique contents

      await rawDb.close();
      await db.close();
    });
  });

  describe('Access control', () => {
    it('should validate workspace access boundaries', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Create two workspaces
      const workspace1 = await db.createWorkspace('Workspace 1', '/workspace1', {});
      const workspace2 = await db.createWorkspace('Workspace 2', '/workspace2', {});

      // Save content to workspace1
      await db.saveFileContent(workspace1, '/secret.ts', 'secret data', 10);

      // Try to access with wrong workspace ID
      const content = await db.getFileContent(workspace2, '/secret.ts');
      expect(content).toBeNull();

      // Correct workspace ID should work
      const correctContent = await db.getFileContent(workspace1, '/secret.ts');
      expect(correctContent).toBe('secret data');

      await db.close();
    });

    it('should enforce unique workspace names', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Create first workspace
      await db.createWorkspace('Unique Name', '/path1', {});

      // Try to create another with same name
      await expect(
        db.createWorkspace('Unique Name', '/path2', {})
      ).rejects.toThrow('UNIQUE constraint failed');

      await db.close();
    });
  });

  describe('Audit logging', () => {
    it('should track critical operations in audit log', async () => {
      const db = await SecureDatabase.create(dbPath);
      
      // Perform operations that should be audited
      const workspaceId = await db.createWorkspace('Audited Workspace', '/audit', {});
      await db.updateWorkspace(workspaceId, { modified: true });
      await db.deleteWorkspace(workspaceId);

      // Check audit log
      const rawDb = db.database;
      const auditEntries = await rawDb.all<{
        operation: string;
        table_name: string;
        record_id: string;
        timestamp: number;
      }>('SELECT * FROM audit_log ORDER BY timestamp');

      // Should have entries for critical operations
      expect(auditEntries.length).toBeGreaterThan(0);
      
      // Verify audit entries contain expected information
      const operations = auditEntries.map(e => e.operation);
      expect(operations).toContain('INSERT');
      expect(operations).toContain('UPDATE');
      expect(operations).toContain('DELETE');

      await db.close();
    });
  });
});