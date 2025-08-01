import { BackupManager, BackupInfo } from '../backup-manager';
import { app, BrowserWindow } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import os from 'os';
import Database from 'better-sqlite3';

const gunzip = promisify(zlib.gunzip);

describe('BackupManager', () => {
  let backupManager: BackupManager;
  let tempDir: string;
  let mockWindow: {
    webContents: {
      executeJavaScript: jest.Mock<Promise<Record<string, string>>, [string]>;
    };
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-backup-test-'));
    jest.spyOn(app, 'getPath').mockReturnValue(tempDir);
    jest.spyOn(app, 'getVersion').mockReturnValue('1.0.0');
    
    backupManager = new BackupManager();
    
    // Mock BrowserWindow
    mockWindow = {
      webContents: {
        executeJavaScript: jest.fn((script: string) => {
          if (script.includes('localStorage')) {
            return Promise.resolve({
              'pasteflow.workspaces': JSON.stringify({ test: 'data' }),
              'pasteflow.system_prompts': JSON.stringify([{ id: '1', name: 'test' }])
            });
          }
          return Promise.resolve({});
        })
      }
    };
    
    (BrowserWindow.getAllWindows as jest.Mock) = jest.fn(() => [mockWindow]);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    jest.restoreAllMocks();
  });

  it('should create compressed backup with correct structure and checksum', async () => {
    // Create test database
    const dbPath = path.join(tempDir, 'pasteflow.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO workspaces VALUES ('1', 'Test Workspace');
    `);
    db.close();
    
    // Create backup
    const backupPath = await backupManager.createFullBackup();
    
    // Verify backup exists
    expect(await fs.pathExists(backupPath)).toBe(true);
    expect(backupPath).toMatch(/pasteflow-backup-.*\.json\.gz$/);
    
    // Verify compressed backup
    const compressed = await fs.readFile(backupPath);
    const decompressed = await gunzip(compressed);
    const backup = JSON.parse(decompressed.toString());
    
    // Verify structure
    expect(backup.version).toBe(2);
    expect(backup.timestamp).toBeTruthy();
    expect(backup.app.version).toBe('1.0.0');
    expect(backup.app.platform).toBe(process.platform);
    
    // Verify localStorage backup
    expect(backup.data.localStorage).toBeDefined();
    expect(backup.data.localStorage['pasteflow.workspaces']).toBe(JSON.stringify({ test: 'data' }));
    
    // Verify database backup
    expect(backup.data.database).toBeDefined();
    expect(backup.data.database.schema).toHaveLength(1);
    expect(backup.data.database.data.workspaces).toHaveLength(1);
    expect(backup.data.database.data.workspaces[0].name).toBe('Test Workspace');
    
    // Verify checksum
    const dataString = JSON.stringify(backup.data);
    const expectedChecksum = crypto.createHash('sha256').update(dataString).digest('hex');
    expect(backup.checksum).toBe(expectedChecksum);
  });

  it('should create uncompressed backup alongside compressed version', async () => {
    const backupPath = await backupManager.createFullBackup();
    const uncompressedPath = backupPath.replace('.gz', '');
    
    expect(await fs.pathExists(uncompressedPath)).toBe(true);
    
    // Verify uncompressed content
    const content = await fs.readFile(uncompressedPath, 'utf-8');
    const backup = JSON.parse(content);
    expect(backup.version).toBe(2);
    expect(backup.checksum).toBeTruthy();
  });

  it('should restore from backup successfully', async () => {
    // Create initial backup
    const backupPath = await backupManager.createFullBackup();
    
    // Modify localStorage mock to simulate restoration
    let restoredData: Record<string, string> = {};
    mockWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
      if (script.includes('localStorage.clear()')) {
        restoredData = {};
      }
      if (script.includes('localStorage.setItem')) {
        // Extract key/value from script
        const matches = script.matchAll(/localStorage\.setItem\("([^"]+)",\s*"([^"]+)"\)/g);
        for (const match of matches) {
          restoredData[match[1]] = match[2];
        }
      }
      return Promise.resolve();
    });
    
    // Restore backup
    await backupManager.restoreFromBackup(backupPath);
    
    // Verify localStorage was restored
    expect(Object.keys(restoredData)).toHaveLength(2);
    expect(restoredData['pasteflow.workspaces']).toBe(JSON.stringify({ test: 'data' }));
  });

  it('should verify checksum before restoring backup', async () => {
    const backupPath = await backupManager.createFullBackup();
    
    // Corrupt the backup
    const content = await fs.readFile(backupPath.replace('.gz', ''), 'utf-8');
    const backup = JSON.parse(content);
    backup.data.localStorage['corrupted'] = 'data';
    
    const compressed = await promisify(zlib.gzip)(JSON.stringify(backup));
    await fs.writeFile(backupPath, compressed);
    
    // Attempt restore
    await expect(backupManager.restoreFromBackup(backupPath))
      .rejects.toThrow('Backup checksum verification failed');
  });

  it('should clean old backups keeping only last 10', async () => {
    // Create 15 backups
    for (let i = 0; i < 15; i++) {
      await backupManager.createFullBackup();
      // Add small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    const backupDir = path.join(tempDir, 'backups');
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter(f => f.startsWith('pasteflow-backup-'));
    
    // Should have 20 files (10 compressed + 10 uncompressed)
    expect(backupFiles).toHaveLength(20);
    
    // Verify newest backups are kept
    const sortedFiles = backupFiles
      .filter(f => f.endsWith('.gz'))
      .sort()
      .reverse();
    
    expect(sortedFiles).toHaveLength(10);
  });

  it('should handle missing localStorage gracefully', async () => {
    (BrowserWindow.getAllWindows as jest.Mock).mockReturnValue([]);
    
    const backupPath = await backupManager.createFullBackup();
    
    // Verify backup was created without localStorage data
    const compressed = await fs.readFile(backupPath);
    const decompressed = await gunzip(compressed);
    const backup = JSON.parse(decompressed.toString());
    
    expect(backup.data.localStorage).toEqual({});
    expect(backup.data.database).toBeDefined();
  });

  it('should get sorted backup list with metadata', async () => {
    // Create multiple backups
    await backupManager.createFullBackup();
    await new Promise(resolve => setTimeout(resolve, 50));
    await backupManager.createFullBackup();
    await new Promise(resolve => setTimeout(resolve, 50));
    await backupManager.createFullBackup();
    
    const backups = await backupManager.getBackupList();
    
    // Should have 6 entries (3 compressed + 3 uncompressed)
    expect(backups.length).toBeGreaterThanOrEqual(6);
    
    // Verify sorting (newest first)
    const compressedBackups = backups.filter(b => b.compressed);
    expect(compressedBackups).toHaveLength(3);
    
    for (let i = 1; i < compressedBackups.length; i++) {
      expect(compressedBackups[i - 1].created.getTime())
        .toBeGreaterThanOrEqual(compressedBackups[i].created.getTime());
    }
    
    // Verify metadata
    const firstBackup = compressedBackups[0];
    expect(firstBackup.filename).toMatch(/^pasteflow-backup-.*\.json\.gz$/);
    expect(firstBackup.size).toBeGreaterThan(0);
    expect(firstBackup.compressed).toBe(true);
    expect(firstBackup.path).toContain(tempDir);
  });

  it('should correctly report backup availability', async () => {
    // Initially no backups
    expect(await backupManager.hasValidBackup()).toBe(false);
    
    // Create backup
    await backupManager.createFullBackup();
    
    // Now should have backup
    expect(await backupManager.hasValidBackup()).toBe(true);
    
    // Clear backups directory
    const backupDir = path.join(tempDir, 'backups');
    await fs.emptyDir(backupDir);
    
    // Should report no backups again
    expect(await backupManager.hasValidBackup()).toBe(false);
  });
});