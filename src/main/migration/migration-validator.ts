import { BrowserWindow } from 'electron';
import { STORAGE_KEYS } from '../../constants';
import { ExtractedData } from './localStorage-extractor';
import { SecureDatabase } from '../db/secure-database';

export interface ValidationResult {
  isValid: boolean;
  issues?: ValidationIssue[];
  warnings?: string[];
  errors?: string[];
  stats?: Record<string, number>;
}

export interface ValidationIssue {
  type: 'parse_error' | 'data_integrity' | 'missing_field' | 'database_integrity';
  key: string;
  message: string;
}

export class MigrationValidator {
  constructor(private db: SecureDatabase) {}

  async validateLocalStorageData(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];

    const data = await this.getLocalStorageData();

    const totalSize = Object.values(data).reduce(
      (sum, value) => sum + value.length,
      0
    );

    if (totalSize > 5 * 1024 * 1024) {
      warnings.push(`Large localStorage size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    }

    for (const [key, value] of Object.entries(data)) {
      try {
        JSON.parse(value);
      } catch {
        issues.push({
          type: 'parse_error',
          key,
          message: 'Invalid JSON format'
        });
      }
    }

    const requiredKeys = [
      STORAGE_KEYS.WORKSPACES,
      STORAGE_KEYS.SYSTEM_PROMPTS
    ];

    for (const key of requiredKeys) {
      if (!data[key]) {
        warnings.push(`Missing expected key: ${key}`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  async validateExtractedData(data: ExtractedData): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const [name, workspace] of Object.entries(data.workspaces)) {
      const workspaceData = workspace as Record<string, unknown>;
      
      if (!workspaceData.selectedFolder && workspaceData.files && Array.isArray(workspaceData.files) && workspaceData.files.length > 0) {
        issues.push({
          type: 'data_integrity',
          key: `workspace:${name}`,
          message: 'Workspace has files but no folder path'
        });
      }

      if (Array.isArray(workspaceData.files)) {
        for (const file of workspaceData.files) {
          const fileData = file as Record<string, unknown>;
          if (!fileData.path) {
            issues.push({
              type: 'missing_field',
              key: `file:${fileData.name}`,
              message: 'File missing path'
            });
          }
        }
      }
    }

    const validatePrompt = (prompt: unknown, type: string) => {
      const promptData = prompt as Record<string, unknown>;
      if (!promptData.name || !promptData.content) {
        issues.push({
          type: 'missing_field',
          key: `${type}:${promptData.id}`,
          message: 'Prompt missing required fields'
        });
      }
    };

    data.prompts.system.forEach(p => validatePrompt(p, 'system_prompt'));
    data.prompts.role.forEach(p => validatePrompt(p, 'role_prompt'));

    if (issues.length > 0) {
      errors.push(...issues.map(issue => issue.message));
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      errors
    };
  }

  async validateMigratedData(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];

    const integrity = await this.db.database.get('PRAGMA integrity_check');
    
    if (!integrity || integrity.integrity_check !== 'ok') {
      issues.push({
        type: 'database_integrity',
        key: 'database',
        message: 'Database integrity check failed'
      });
    }

    const counts = {
      workspaces: await this.getTableCount('workspaces'),
      prompts: await this.getTableCount('prompts'),
      preferences: await this.getTableCount('preferences')
    };

    if (counts.workspaces === 0 && counts.prompts === 0) {
      warnings.push('No data was migrated');
    }

    const orphanedFiles = await this.db.database.get(`
      SELECT COUNT(*) as count FROM files 
      WHERE workspace_id NOT IN (SELECT id FROM workspaces)
    `);

    if (orphanedFiles && orphanedFiles.count > 0) {
      issues.push({
        type: 'data_integrity',
        key: 'files',
        message: `${orphanedFiles.count} orphaned files found`
      });
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      stats: counts
    };
  }

  private async getLocalStorageData(): Promise<Record<string, string>> {
    const windows = BrowserWindow.getAllWindows();
    
    if (windows.length === 0) {
      return {};
    }

    return await windows[0].webContents.executeJavaScript(`
      (function() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      })()
    `);
  }

  private async getTableCount(table: string): Promise<number> {
    const result = await this.db.database.get(
      `SELECT COUNT(*) as count FROM ${table}`
    );
    return result ? result.count : 0;
  }
}