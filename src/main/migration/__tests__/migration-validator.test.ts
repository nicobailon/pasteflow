import { MigrationValidator } from '../migration-validator';
import { ExtractedData } from '../localStorage-extractor';
import { SecureDatabase } from '../../db/secure-database';
import { STORAGE_KEYS } from '../../../constants';
import { BrowserWindow } from 'electron';

describe('MigrationValidator', () => {
  let validator: MigrationValidator;
  let testDb: SecureDatabase;
  let mockWindow: {
    webContents: {
      executeJavaScript: jest.Mock<Promise<Record<string, string>>, [string]>;
    };
  };

  beforeEach(async () => {
    testDb = await SecureDatabase.create(':memory:');
    validator = new MigrationValidator(testDb);
    
    mockWindow = {
      webContents: {
        executeJavaScript: jest.fn()
      }
    };
    
    (BrowserWindow.getAllWindows as jest.Mock) = jest.fn(() => [mockWindow]);
  });

  describe('validateLocalStorageData', () => {
    it('should validate correct localStorage data successfully', async () => {
      mockWindow.webContents.executeJavaScript.mockResolvedValue({
        [STORAGE_KEYS.WORKSPACES]: JSON.stringify({ test: 'data' }),
        [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([{ id: '1', name: 'test' }])
      });

      const result = await validator.validateLocalStorageData();
      
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect invalid JSON in localStorage', async () => {
      mockWindow.webContents.executeJavaScript.mockResolvedValue({
        [STORAGE_KEYS.WORKSPACES]: 'invalid json{',
        [STORAGE_KEYS.SYSTEM_PROMPTS]: JSON.stringify([])
      });

      const result = await validator.validateLocalStorageData();
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('parse_error');
      expect(result.issues![0].key).toBe(STORAGE_KEYS.WORKSPACES);
      expect(result.issues![0].message).toBe('Invalid JSON format');
    });

    it('should warn about large localStorage size', async () => {
      const largeData = 'x'.repeat(6 * 1024 * 1024); // 6MB
      mockWindow.webContents.executeJavaScript.mockResolvedValue({
        [STORAGE_KEYS.WORKSPACES]: largeData
      });

      const result = await validator.validateLocalStorageData();
      
      expect(result.warnings).toHaveLength(2); // Size warning + missing key warning
      expect(result.warnings![0]).toContain('Large localStorage size');
      expect(result.warnings![0]).toContain('6.00MB');
    });

    it('should warn about missing expected keys', async () => {
      mockWindow.webContents.executeJavaScript.mockResolvedValue({
        'some.other.key': 'value'
      });

      const result = await validator.validateLocalStorageData();
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(`Missing expected key: ${STORAGE_KEYS.WORKSPACES}`);
      expect(result.warnings).toContain(`Missing expected key: ${STORAGE_KEYS.SYSTEM_PROMPTS}`);
    });
  });

  describe('validateExtractedData', () => {
    it('should validate well-formed extracted data', async () => {
      const extractedData: ExtractedData = {
        workspaces: {
          'Test Workspace': {
            selectedFolder: '/test',
            files: [
              { name: 'file.ts', path: '/test/file.ts', size: 100, isBinary: false }
            ]
          }
        },
        prompts: {
          system: [{ id: '1', name: 'System', content: 'Content' }],
          role: [{ id: '2', name: 'Role', content: 'Content' }],
          active: { systemIds: ['1'], roleIds: [] }
        },
        preferences: {},
        fileSelections: [],
        expandedNodes: {},
        instructions: [],
        recentFolders: [],
        uiState: {},
        rawData: {}
      };

      const result = await validator.validateExtractedData(extractedData);
      
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect workspace integrity issues', async () => {
      const extractedData: ExtractedData = {
        workspaces: {
          'Broken Workspace': {
            selectedFolder: null,
            files: [
              { name: 'file.ts', path: '/test/file.ts', size: 100, isBinary: false }
            ]
          }
        },
        prompts: { system: [], role: [], active: { systemIds: [], roleIds: [] } },
        preferences: {},
        fileSelections: [],
        expandedNodes: {},
        instructions: [],
        recentFolders: [],
        uiState: {},
        rawData: {}
      };

      const result = await validator.validateExtractedData(extractedData);
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('data_integrity');
      expect(result.issues![0].key).toBe('workspace:Broken Workspace');
      expect(result.issues![0].message).toBe('Workspace has files but no folder path');
    });

    it('should detect missing file paths', async () => {
      const extractedData: ExtractedData = {
        workspaces: {
          'Test': {
            selectedFolder: '/test',
            files: [
              { name: 'orphan.ts', size: 100 } // Missing path
            ]
          }
        },
        prompts: { system: [], role: [], active: { systemIds: [], roleIds: [] } },
        preferences: {},
        fileSelections: [],
        expandedNodes: {},
        instructions: [],
        recentFolders: [],
        uiState: {},
        rawData: {}
      };

      const result = await validator.validateExtractedData(extractedData);
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('missing_field');
      expect(result.issues![0].key).toBe('file:orphan.ts');
      expect(result.issues![0].message).toBe('File missing path');
    });

    it('should detect invalid prompts', async () => {
      const extractedData: ExtractedData = {
        workspaces: {},
        prompts: {
          system: [{ id: '1', name: '', content: '' }], // Empty name and content
          role: [{ id: '2', content: 'Content' }], // Missing name
          active: { systemIds: [], roleIds: [] }
        },
        preferences: {},
        fileSelections: [],
        expandedNodes: {},
        instructions: [],
        recentFolders: [],
        uiState: {},
        rawData: {}
      };

      const result = await validator.validateExtractedData(extractedData);
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      
      const systemPromptIssue = result.issues!.find(i => i.key === 'system_prompt:1');
      expect(systemPromptIssue).toBeDefined();
      expect(systemPromptIssue!.message).toBe('Prompt missing required fields');
      
      const rolePromptIssue = result.issues!.find(i => i.key === 'role_prompt:2');
      expect(rolePromptIssue).toBeDefined();
    });
  });

  describe('validateMigratedData', () => {
    it('should validate successful migration', async () => {
      // Populate test data
      await testDb.database.run(`
        INSERT INTO workspaces (id, name, folder_path, state_json, created_at, updated_at)
        VALUES ('1', 'Test', '/test', '{}', 1000, 1000)
      `);
      
      await testDb.database.run(`
        INSERT INTO prompts (id, type, name, content, token_count, is_active, created_at)
        VALUES ('1', 'system', 'Test', 'Content', 10, 1, 1000)
      `);
      
      await testDb.database.run(`
        INSERT INTO preferences (key, value, encrypted, updated_at)
        VALUES ('theme', 'dark', 0, 1000)
      `);

      const result = await validator.validateMigratedData();
      
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.stats).toEqual({
        workspaces: 1,
        prompts: 1,
        preferences: 1
      });
    });

    it('should detect orphaned files', async () => {
      // Add workspace and orphaned file
      await testDb.database.run(`
        INSERT INTO workspaces (id, name, folder_path, state_json, created_at, updated_at)
        VALUES ('ws1', 'Test', '/test', '{}', 1000, 1000)
      `);
      
      await testDb.database.run(`
        INSERT INTO files (path, workspace_id, size, is_binary, last_modified)
        VALUES ('/test/file1.ts', 'ws1', 100, 0, 1000),
               ('/test/orphan.ts', 'non-existent-ws', 200, 0, 1000)
      `);

      const result = await validator.validateMigratedData();
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('data_integrity');
      expect(result.issues![0].key).toBe('files');
      expect(result.issues![0].message).toBe('1 orphaned files found');
    });

    it('should warn when no data was migrated', async () => {
      const result = await validator.validateMigratedData();
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('No data was migrated');
      expect(result.stats).toEqual({
        workspaces: 0,
        prompts: 0,
        preferences: 0
      });
    });

    it('should handle database integrity check failure', async () => {
      // Mock integrity check failure
      jest.spyOn(testDb.database, 'get').mockImplementation((sql: string) => {
        if (sql.includes('PRAGMA integrity_check')) {
          return { integrity_check: 'corruption detected' };
        }
        return null;
      });

      const result = await validator.validateMigratedData();
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('database_integrity');
      expect(result.issues![0].message).toBe('Database integrity check failed');
    });
  });
});