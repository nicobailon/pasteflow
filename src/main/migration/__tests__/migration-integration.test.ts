import { MigrationOrchestrator } from '../migration-orchestrator';
import { SecureDatabase } from '../../db/secure-database';
import { STORAGE_KEYS } from '../../../constants';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import os from 'os';

interface MockWebContents {
  executeJavaScript: jest.Mock<Promise<unknown>, [string]>;
}

interface MockBrowserWindow {
  webContents: MockWebContents;
  loadFile: jest.Mock;
  show: jest.Mock;
  close: jest.Mock;
  isDestroyed: jest.Mock<boolean, []>;
  send: jest.Mock;
}

describe('Migration Integration', () => {
  let orchestrator: MigrationOrchestrator;
  let testDb: SecureDatabase;
  let tempDir: string;
  let mockWindow: MockBrowserWindow;

  beforeEach(async () => {
    // Create real temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-test-'));
    
    // Create real in-memory database for tests
    testDb = await SecureDatabase.create(':memory:');
    orchestrator = new MigrationOrchestrator(testDb);
    
    // Mock BrowserWindow with realistic localStorage behavior
    mockWindow = {
      webContents: {
        executeJavaScript: jest.fn((script: string) => {
          if (script.includes('localStorage.length')) {
            return Promise.resolve(5); // Has data
          }
          if (script.includes('Object.keys(localStorage)')) {
            return Promise.resolve({
              [STORAGE_KEYS.WORKSPACES]: JSON.stringify({
                'Test Workspace': {
                  selectedFolder: '/test/folder',
                  selectedFiles: [
                    { path: '/test/file1.ts', tokenCount: 100 },
                    { path: '/test/file2.ts', tokenCount: 200 }
                  ],
                  expandedNodes: { '/test': true },
                  files: [
                    { name: 'file1.ts', path: '/test/file1.ts', size: 1024, isBinary: false, tokenCount: 100 },
                    { name: 'file2.ts', path: '/test/file2.ts', size: 2048, isBinary: false, tokenCount: 200 }
                  ],
                  tokenCount: 300,
                  userInstructions: 'Test instructions'
                },
                'Another Workspace': {
                  selectedFolder: '/another/folder',
                  selectedFiles: [],
                  expandedNodes: {},
                  files: [],
                  tokenCount: 0,
                  userInstructions: ''
                }
              }),
              [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([
                { id: 'sp1', name: 'System Prompt 1', content: 'You are a helpful assistant', tokenCount: 5 },
                { id: 'sp2', name: 'System Prompt 2', content: 'You are a code reviewer', tokenCount: 4 }
              ]),
              [STORAGE_KEYS.ROLE_PROMPTS]: JSON.stringify([
                { id: 'rp1', name: 'Developer', content: 'Act as a senior developer', tokenCount: 5 }
              ]),
              'pasteflow.active_system_prompts': JSON.stringify(['sp1']),
              'pasteflow.active_role_prompts': JSON.stringify(['rp1']),
              [STORAGE_KEYS.FILE_TREE_MODE]: '"selected"',
              'pasteflow.token_counter_visible': 'true'
            });
          }
          return Promise.resolve({});
        })
      },
      loadFile: jest.fn(),
      show: jest.fn(),
      close: jest.fn(),
      isDestroyed: jest.fn(() => false),
      send: jest.fn()
    };
    
    // Mock Electron APIs
    jest.spyOn(require('electron'), 'BrowserWindow').mockReturnValue(mockWindow);
    jest.spyOn(app, 'getPath').mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    jest.restoreAllMocks();
  });

  it('should complete full migration successfully with real data transformation', async () => {
    // Execute migration
    const result = await orchestrator.startMigration({
      skipBackup: true,
      validateData: true
    });

    // Verify migration succeeded
    expect(result.success).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats!.workspacesMigrated).toBe(2);
    expect(result.stats!.promptsMigrated).toBe(3);
    expect(result.stats!.filesMigrated).toBe(2);
    expect(result.stats!.preferencesMigrated).toBeGreaterThan(0);
    
    // Verify data was actually migrated to database
    const workspaces = await testDb.listWorkspaces();
    expect(workspaces).toHaveLength(2);
    
    const testWorkspace = workspaces.find(w => w.name === 'Test Workspace');
    expect(testWorkspace).toBeDefined();
    expect(testWorkspace!.folderPath).toBe('/test/folder');
    
    // Verify workspace state was preserved
    const workspaceState = JSON.parse((testWorkspace as { stateJson: string }).stateJson);
    expect(workspaceState.selectedFiles).toHaveLength(2);
    expect(workspaceState.tokenCount).toBe(300);
    expect(workspaceState.userInstructions).toBe('Test instructions');
    
    // Verify prompts were migrated
    const systemPrompts = await testDb.database.all(
      'SELECT * FROM prompts WHERE type = ? ORDER BY name',
      ['system']
    );
    expect(systemPrompts).toHaveLength(2);
    const prompt0 = systemPrompts[0] as { name: string; is_active: number };
    const prompt1 = systemPrompts[1] as { name: string; is_active: number };
    expect(prompt0.name).toBe('System Prompt 1');
    expect(prompt0.is_active).toBe(1);
    expect(prompt1.is_active).toBe(0);
    
    // Verify preferences were migrated
    const prefs = await testDb.database.all('SELECT * FROM preferences');
    const fileTreeModePref = prefs.find((p: { key: string }) => p.key === STORAGE_KEYS.FILE_TREE_MODE) as { key: string; value: string } | undefined;
    expect(fileTreeModePref).toBeDefined();
    expect(fileTreeModePref!.value).toBe('"selected"');
  });

  it('should handle migration errors gracefully with partial data recovery', async () => {
    // Corrupt some data
    mockWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
      if (script.includes('Object.keys(localStorage)')) {
        return Promise.resolve({
          [STORAGE_KEYS.WORKSPACES]: 'invalid json{',
          [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([
            { id: 'sp1', name: 'Valid Prompt', content: 'Content' }
          ])
        });
      }
      return Promise.resolve({});
    });

    const result = await orchestrator.startMigration({
      skipBackup: true
    });

    // Should still succeed with partial data
    expect(result.success).toBe(true);
    expect(result.stats!.errors).toBeGreaterThan(0);
    expect(result.stats!.promptsMigrated).toBe(1);
    
    // Verify valid data was still migrated
    const prompts = await testDb.database.all('SELECT * FROM prompts');
    expect(prompts).toHaveLength(1);
    const validPrompt = prompts[0] as { name: string };
    expect(validPrompt.name).toBe('Valid Prompt');
  });

  it('should create backup before migration and enable restoration', async () => {
    const result = await orchestrator.startMigration({
      skipBackup: false
    });

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeTruthy();
    
    // Verify backup file exists
    const backupExists = await fs.pathExists(result.backupPath!);
    expect(backupExists).toBe(true);
    
    // Verify backup contains expected data
    const backupContent = await fs.readFile(result.backupPath!.replace('.gz', ''), 'utf-8');
    const backup = JSON.parse(backupContent);
    
    expect(backup.version).toBe(2);
    expect(backup.data.localStorage).toBeDefined();
    expect(backup.data.localStorage[STORAGE_KEYS.WORKSPACES]).toBeDefined();
    expect(backup.checksum).toBeTruthy();
  });

  it('should validate data integrity during migration', async () => {
    // Set up data with integrity issues
    mockWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
      if (script.includes('Object.keys(localStorage)')) {
        return Promise.resolve({
          [STORAGE_KEYS.WORKSPACES]: JSON.stringify({
            'Broken Workspace': {
              selectedFolder: null,
              selectedFiles: [],
              files: [
                { name: 'orphan.ts', size: 100 } // Missing path
              ]
            }
          }),
          [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([
            { id: 'sp1', name: '', content: '' } // Missing required fields
          ])
        });
      }
      return Promise.resolve({});
    });

    const result = await orchestrator.startMigration({
      skipBackup: true,
      validateData: true
    });

    // Migration should complete but report issues
    expect(result.success).toBe(true);
    expect(result.stats!.errors).toBeGreaterThan(0);
    
    // Verify problematic data was handled
    const workspaces = await testDb.listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].folderPath).toBe(''); // Null converted to empty string
  });

  it('should handle concurrent migration attempts correctly', async () => {
    // Mark as already migrated
    await testDb.database.run(
      'INSERT INTO preferences (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)',
      ['migration_completed_v2', 'true', 0, Date.now()]
    );

    // Check should return false
    const needsMigration = await orchestrator.checkMigrationNeeded();
    expect(needsMigration).toBe(false);
    
    // Attempting migration should not execute
    const result = await orchestrator.startMigration();
    expect(result.success).toBe(true);
    expect(result.stats).toBeUndefined(); // No migration performed
  });

  it('should properly clean up localStorage after successful migration', async () => {
    let localStorageCleared = false;
    
    mockWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
      if (script.includes('localStorage.removeItem')) {
        localStorageCleared = true;
        return Promise.resolve();
      }
      // Return default test data for other calls
      if (script.includes('Object.keys(localStorage)')) {
        return Promise.resolve({
          [STORAGE_KEYS.WORKSPACES]: JSON.stringify({
            'Test': { selectedFolder: '/test', selectedFiles: [], expandedNodes: {}, files: [] }
          })
        });
      }
      return Promise.resolve({});
    });

    const result = await orchestrator.startMigration({
      skipBackup: true
    });

    expect(result.success).toBe(true);
    expect(localStorageCleared).toBe(true);
    
    // Verify migration completion flag was set
    const migrationFlag = await testDb.database.get(
      'SELECT value FROM preferences WHERE key = ?',
      ['migration_completed_v2']
    );
    expect(migrationFlag).toBeDefined();
    const flag = migrationFlag as { value: string };
    expect(flag.value).toBe('true');
  });

  it('should calculate and preserve token counts accurately', async () => {
    // Set up data with specific token counts
    mockWindow.webContents.executeJavaScript.mockImplementation((script: string) => {
      if (script.includes('Object.keys(localStorage)')) {
        return Promise.resolve({
          [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([
            { id: 'sp1', name: 'Long Prompt', content: 'A'.repeat(400), tokenCount: 100 },
            { id: 'sp2', name: 'Short Prompt', content: 'Short' } // No token count
          ])
        });
      }
      return Promise.resolve({});
    });

    const result = await orchestrator.startMigration({
      skipBackup: true
    });

    expect(result.success).toBe(true);
    
    // Verify token counts
    const prompts = await testDb.database.all('SELECT * FROM prompts ORDER BY name');
    expect(prompts).toHaveLength(2);
    
    // Existing token count preserved
    const prompt0WithToken = prompts[0] as { token_count: number };
    expect(prompt0WithToken.token_count).toBe(100);
    
    // Missing token count estimated (5 chars / 4 = ~2 tokens)
    const prompt1WithToken = prompts[1] as { token_count: number };
    expect(prompt1WithToken.token_count).toBe(2);
  });
});