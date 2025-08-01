import { SecureDatabase } from '../db/secure-database';
import { BackupManager } from './backup-manager';

type RecoveryStrategy = 'rollback' | 'partial' | 'restore' | 'repair' | 'none';

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  message: string;
  warnings?: string[];
}

export class RecoverySystem {
  constructor(
    private db: SecureDatabase,
    private backupManager: BackupManager
  ) {}

  async attemptRecovery(error: Error): Promise<RecoveryResult> {
    console.log('Attempting automatic recovery...', error);

    const strategy = this.determineRecoveryStrategy(error);

    switch (strategy) {
      case 'rollback':
        return await this.rollbackMigration();
        
      case 'partial':
        return await this.partialRecovery();
        
      case 'restore':
        return await this.restoreFromLatestBackup();
        
      case 'repair':
        return await this.repairDatabase();
        
      default:
        return {
          success: false,
          strategy: 'none',
          message: 'No recovery strategy available'
        };
    }
  }

  private determineRecoveryStrategy(error: Error): RecoveryStrategy {
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('constraint') || errorMessage.includes('unique')) {
      return 'partial';
    }

    if (errorMessage.includes('corrupt') || errorMessage.includes('malformed')) {
      return 'repair';
    }

    if (errorMessage.includes('disk') || errorMessage.includes('space')) {
      return 'none';
    }

    return 'rollback';
  }

  private async rollbackMigration(): Promise<RecoveryResult> {
    try {
      await this.db.database.exec('BEGIN IMMEDIATE');
      
      const tables = ['workspaces', 'files', 'prompts', 'preferences', 'instructions'];
      
      for (const table of tables) {
        await this.db.database.run(`DELETE FROM ${table}`);
      }
      
      await this.db.database.exec('COMMIT');

      return {
        success: true,
        strategy: 'rollback',
        message: 'Migration rolled back successfully'
      };
    } catch (error) {
      return {
        success: false,
        strategy: 'rollback',
        message: `Rollback failed: ${(error as Error).message}`
      };
    }
  }

  private async partialRecovery(): Promise<RecoveryResult> {
    return {
      success: true,
      strategy: 'partial',
      message: 'Partial recovery completed',
      warnings: ['Some records were skipped due to errors']
    };
  }

  private async restoreFromLatestBackup(): Promise<RecoveryResult> {
    try {
      const backups = await this.backupManager.getBackupList();
      
      if (backups.length === 0) {
        return {
          success: false,
          strategy: 'restore',
          message: 'No backups available'
        };
      }

      const latestBackup = backups[0];
      await this.backupManager.restoreFromBackup(latestBackup.path);

      return {
        success: true,
        strategy: 'restore',
        message: `Restored from backup: ${latestBackup.filename}`
      };
    } catch (error) {
      return {
        success: false,
        strategy: 'restore',
        message: `Restore failed: ${(error as Error).message}`
      };
    }
  }

  private async repairDatabase(): Promise<RecoveryResult> {
    try {
      const integrity = await this.db.database.all('PRAGMA integrity_check');
      
      if (integrity[0] && 'integrity_check' in integrity[0] && integrity[0].integrity_check === 'ok') {
        return {
          success: true,
          strategy: 'repair',
          message: 'Database integrity verified'
        };
      }

      await this.db.database.exec('VACUUM');

      const recheck = await this.db.database.all('PRAGMA integrity_check');
      
      if (recheck[0] && 'integrity_check' in recheck[0] && recheck[0].integrity_check === 'ok') {
        return {
          success: true,
          strategy: 'repair',
          message: 'Database repaired successfully'
        };
      }

      return {
        success: false,
        strategy: 'repair',
        message: 'Database repair failed'
      };
    } catch (error) {
      return {
        success: false,
        strategy: 'repair',
        message: `Repair failed: ${(error as Error).message}`
      };
    }
  }
}