import { BrowserWindow } from 'electron';
import * as path from 'path';
import { LocalStorageMigrator } from './localStorage-migrator';
import { BackupManager } from './backup-manager';
import { MigrationValidator } from './migration-validator';
import { RecoverySystem } from './recovery-system';
import { SecureDatabase } from '../db/secure-database';

export interface MigrationOptions {
  skipBackup?: boolean;
  validateData?: boolean;
  dryRun?: boolean;
}

export interface MigrationResult {
  success: boolean;
  dryRun?: boolean;
  stats?: MigrationStats;
  error?: string;
  backupPath?: string | null;
  recoverable?: boolean;
}

export interface MigrationStats {
  workspacesMigrated: number;
  promptsMigrated: number;
  preferencesMigrated: number;
  filesMigrated: number;
  errors: number;
  duration?: number;
  timestamp?: string;
}

export interface MigrationProgress {
  percent: number;
  message: string;
  details?: unknown;
  timestamp: string;
}

export class MigrationOrchestrator {
  private migrator: LocalStorageMigrator;
  private backupManager: BackupManager;
  private validator: MigrationValidator;
  private recoverySystem: RecoverySystem;
  private migrationWindow: BrowserWindow | null = null;

  constructor(private db: SecureDatabase) {
    this.migrator = new LocalStorageMigrator(db);
    this.backupManager = new BackupManager();
    this.validator = new MigrationValidator(db);
    this.recoverySystem = new RecoverySystem(db, this.backupManager);
  }

  async checkMigrationNeeded(): Promise<boolean> {
    const migrated = await this.db.database.get(
      'SELECT value FROM preferences WHERE key = ?',
      ['migration_completed_v2']
    );

    if (migrated) {
      return false;
    }

    const hasLocalStorageData = await this.detectLocalStorageData();
    return hasLocalStorageData;
  }

  async startMigration(options: MigrationOptions = {}): Promise<MigrationResult> {
    console.log('Starting PasteFlow data migration...');
    
    try {
      await this.showMigrationUI();
      
      this.updateProgress(0, 'Validating existing data...');
      const validation = await this.validator.validateLocalStorageData();
      
      if (!validation.isValid && !options.skipBackup) {
        this.updateProgress(0, 'Data validation warnings found', validation.warnings);
      }

      let backupPath: string | null = null;
      if (!options.skipBackup) {
        this.updateProgress(10, 'Creating backup of current data...');
        backupPath = await this.backupManager.createFullBackup();
        this.updateProgress(20, `Backup created: ${path.basename(backupPath)}`);
      }

      this.updateProgress(25, 'Extracting data from localStorage...');
      const localData = await this.extractAllLocalStorageData();
      
      this.updateProgress(30, 'Validating extracted data...');
      const extractedValidation = await this.validator.validateExtractedData(localData);
      
      if (!extractedValidation.isValid) {
        throw new Error(`Invalid data detected: ${extractedValidation.errors?.join(', ') || 'validation failed'}`);
      }

      if (options.dryRun) {
        this.updateProgress(40, 'Performing dry run...');
        const dryRunResult = await this.migrator.dryRun(localData);
        
        if (!dryRunResult.success) {
          throw new Error(`Dry run failed: ${dryRunResult.error}`);
        }
        
        this.updateProgress(100, 'Dry run completed successfully');
        return {
          success: true,
          dryRun: true,
          stats: dryRunResult.stats as MigrationStats
        };
      }

      this.updateProgress(40, 'Migrating data to new storage...');
      const migrationResult = await this.executeMigration(localData);
      
      if (options.validateData) {
        this.updateProgress(80, 'Validating migrated data...');
        const postValidation = await this.validator.validateMigratedData();
        
        if (!postValidation.isValid) {
          throw new Error('Post-migration validation failed');
        }
      }

      this.updateProgress(90, 'Cleaning up old data...');
      await this.cleanupLocalStorage();
      
      await this.markMigrationComplete();
      
      this.updateProgress(100, 'Migration completed successfully!');
      
      setTimeout(() => {
        this.closeMigrationUI();
      }, 2000);

      return {
        success: true,
        stats: migrationResult.stats,
        backupPath: options.skipBackup ? null : backupPath
      };

    } catch (error) {
      console.error('Migration failed:', error);
      
      this.updateProgress(-1, 'Migration failed, attempting recovery...');
      
      try {
        await this.recoverFromError(error as Error);
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
      }
      
      return {
        success: false,
        error: (error as Error).message,
        recoverable: await this.backupManager.hasValidBackup()
      };
    } finally {
      // Ensure window cleanup
      this.closeMigrationUI();
      
      // Clear any remaining references
      this.migrationWindow = null;
    }
  }

  private async detectLocalStorageData(): Promise<boolean> {
    const windows = BrowserWindow.getAllWindows();
    
    if (windows.length === 0) {
      const checkWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '../../preload.js')
        }
      });
      
      await checkWindow.loadFile('index.html');
      
      const hasData = await checkWindow.webContents.executeJavaScript(`
        Object.keys(localStorage).some(key => 
          key.startsWith('pasteflow_') || 
          key.includes('workspace') ||
          key.includes('prompt')
        )
      `);
      
      checkWindow.close();
      
      return hasData;
    }
    
    return await windows[0].webContents.executeJavaScript(`
      Object.keys(localStorage).length > 0
    `);
  }

  private async showMigrationUI() {
    this.migrationWindow = new BrowserWindow({
      width: 600,
      height: 400,
      center: true,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await this.migrationWindow.loadFile('migration.html');
    this.migrationWindow.show();
  }

  private updateProgress(percent: number, message: string, details?: unknown) {
    if (this.migrationWindow && !this.migrationWindow.isDestroyed()) {
      this.migrationWindow.webContents.send('migration:progress', {
        percent,
        message,
        details,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`[Migration ${percent}%] ${message}`);
  }

  private closeMigrationUI() {
    if (this.migrationWindow && !this.migrationWindow.isDestroyed()) {
      this.migrationWindow.close();
      this.migrationWindow = null;
    }
  }

  private async extractAllLocalStorageData() {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      throw new Error('No window available to extract localStorage data');
    }

    const extractor = await import('./localStorage-extractor');
    return await extractor.LocalStorageExtractor.extractAllData(windows[0]);
  }

  private async executeMigration(data: unknown): Promise<{ stats: MigrationStats }> {
    return await this.migrator.migrate(data);
  }

  private async cleanupLocalStorage() {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      return;
    }

    await windows[0].webContents.executeJavaScript(`
      (function() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('pasteflow')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      })()
    `);
  }

  private async markMigrationComplete() {
    const now = Math.floor(Date.now() / 1000);
    await this.db.database.run(
      'INSERT OR REPLACE INTO preferences (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)',
      ['migration_completed_v2', 'true', 0, now]
    );
  }

  private async recoverFromError(error: Error) {
    await this.recoverySystem.attemptRecovery(error);
  }
}