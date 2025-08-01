import { RecoverySystem } from '../recovery-system';
import { BackupManager } from '../backup-manager';
import { SecureDatabase } from '../../db/secure-database';
import * as fs from 'fs-extra';
import * as path from 'path';
import os from 'os';
import { app } from 'electron';

describe('Recovery System', () => {
  let recoverySystem: RecoverySystem;
  let testDb: SecureDatabase;
  let backupManager: BackupManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-recovery-test-'));
    jest.spyOn(app, 'getPath').mockReturnValue(tempDir);
    
    testDb = await SecureDatabase.create(':memory:');
    backupManager = new BackupManager();
    recoverySystem = new RecoverySystem(testDb, backupManager);
    
    // Populate test data
    await testDb.database.run(`
      INSERT INTO workspaces (id, name, folder_path, state_json, created_at, updated_at)
      VALUES ('test-ws-1', 'Test Workspace', '/test', '{}', 1000, 1000)
    `);
    
    await testDb.database.run(`
      INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at)
      VALUES ('test-prompt-1', 'system', 'Test Prompt', 'Content', 10, 1, 1000)
    `);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    jest.restoreAllMocks();
  });

  it('should recover from constraint violations using partial recovery', async () => {
    const error = new Error('UNIQUE constraint failed: workspaces.name');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('partial');
    expect(result.message).toBe('Partial recovery completed');
    expect(result.warnings).toContain('Some records were skipped due to errors');
  });

  it('should rollback migration on general errors', async () => {
    // Verify data exists before rollback
    const workspacesBefore = await testDb.database.all('SELECT * FROM workspaces');
    const promptsBefore = await testDb.database.all('SELECT * FROM prompts');
    expect(workspacesBefore).toHaveLength(1);
    expect(promptsBefore).toHaveLength(1);
    
    const error = new Error('General migration error');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('rollback');
    expect(result.message).toBe('Migration rolled back successfully');
    
    // Verify data was rolled back
    const workspacesAfter = await testDb.database.all('SELECT * FROM workspaces');
    const promptsAfter = await testDb.database.all('SELECT * FROM prompts');
    expect(workspacesAfter).toHaveLength(0);
    expect(promptsAfter).toHaveLength(0);
  });

  it('should restore from backup when database corrupted', async () => {
    // Create a real backup first
    const backupPath = await backupManager.createFullBackup();
    expect(await fs.pathExists(backupPath)).toBe(true);
    
    // Simulate corruption error
    const error = new Error('database disk image is malformed');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('restore');
    expect(result.message).toContain('Restored from backup');
    
    // Verify backup list is available
    const backups = await backupManager.getBackupList();
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0].compressed).toBe(true);
  });

  it('should attempt database repair for corruption errors', async () => {
    const error = new Error('database is corrupt');
    const result = await recoverySystem.attemptRecovery(error);
    
    // Should attempt repair and verify integrity
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('repair');
    expect(result.message).toContain('Database integrity verified');
  });

  it('should handle unrecoverable errors appropriately', async () => {
    const error = new Error('disk space full');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('none');
    expect(result.message).toBe('No recovery strategy available');
  });

  it('should handle rollback failures gracefully', async () => {
    // Close database to cause rollback failure
    testDb.database.close();
    
    const error = new Error('General error');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('rollback');
    expect(result.message).toContain('Rollback failed');
  });

  it('should handle missing backups during restore attempt', async () => {
    // Ensure no backups exist
    const backupDir = path.join(tempDir, 'backups');
    await fs.emptyDir(backupDir);
    
    const error = new Error('database corrupted');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('restore');
    expect(result.message).toBe('No backups available');
  });

  it('should vacuum database during repair process', async () => {
    // Track if VACUUM was called
    let vacuumCalled = false;
    const originalExec = testDb.database.exec;
    testDb.database.exec = jest.fn((sql: string) => {
      if (sql === 'VACUUM') {
        vacuumCalled = true;
      }
      return originalExec.call(testDb.database, sql);
    });
    
    const error = new Error('database needs repair');
    const result = await recoverySystem.attemptRecovery(error);
    
    expect(result.success).toBe(true);
    expect(vacuumCalled).toBe(true);
    expect(result.message).toContain('Database integrity verified');
  });
});