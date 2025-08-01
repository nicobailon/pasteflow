import * as fs from 'fs-extra';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  created: Date;
  compressed: boolean;
}

interface BackupData {
  version: number;
  timestamp: string;
  app: {
    version: string;
    platform: string;
    arch: string;
  };
  data: {
    localStorage: Record<string, string>;
    database: DatabaseBackup | null;
    preferences: Record<string, unknown>;
  };
  checksum: string;
}

interface DatabaseBackup {
  schema: Array<{ sql: string }>;
  data: Record<string, unknown[]>;
}

export class BackupManager {
  private backupDir: string;

  constructor() {
    this.backupDir = path.join(app.getPath('userData'), 'backups');
    fs.ensureDirSync(this.backupDir);
  }

  async createFullBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `pasteflow-backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, backupName);

    const backup: BackupData = {
      version: 2,
      timestamp: new Date().toISOString(),
      app: {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      },
      data: {
        localStorage: await this.backupLocalStorage(),
        database: await this.backupDatabase(),
        preferences: await this.backupPreferences()
      },
      checksum: ''
    };

    const dataString = JSON.stringify(backup.data);
    backup.checksum = crypto
      .createHash('sha256')
      .update(dataString)
      .digest('hex');

    const compressed = await this.compress(JSON.stringify(backup, null, 2));
    
    await fs.writeFile(`${backupPath}.json.gz`, compressed, {
      mode: 0o600
    });

    await fs.writeFile(
      `${backupPath}.json`,
      JSON.stringify(backup, null, 2),
      { mode: 0o600 }
    );

    await this.cleanOldBackups();

    return `${backupPath}.json.gz`;
  }

  private async backupLocalStorage(): Promise<Record<string, string>> {
    const windows = BrowserWindow.getAllWindows();
    
    if (windows.length === 0) {
      return {};
    }

    const data = await windows[0].webContents.executeJavaScript(`
      (function() {
        const backup = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          backup[key] = localStorage.getItem(key);
        }
        return backup;
      })()
    `);

    return data;
  }

  private async backupDatabase(): Promise<DatabaseBackup | null> {
    const dbPath = path.join(app.getPath('userData'), 'pasteflow.db');
    
    if (!await fs.pathExists(dbPath)) {
      return null;
    }

    const db = new Database(dbPath, { readonly: true });
    
    const backup: DatabaseBackup = {
      schema: db.prepare('SELECT sql FROM sqlite_master WHERE type = "table"').all() as Array<{ sql: string }>,
      data: {}
    };

    const tables = db.prepare(
      'SELECT name FROM sqlite_master WHERE type = "table" AND name NOT LIKE "sqlite_%"'
    ).all() as Array<{ name: string }>;

    for (const { name } of tables) {
      backup.data[name] = db.prepare(`SELECT * FROM ${name}`).all();
    }

    db.close();

    return backup;
  }

  private async backupPreferences(): Promise<Record<string, unknown>> {
    const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
    
    if (await fs.pathExists(prefsPath)) {
      return await fs.readJson(prefsPath);
    }
    
    return {};
  }

  async restoreFromBackup(backupPath: string): Promise<void> {
    console.log(`Restoring from backup: ${backupPath}`);

    const compressed = await fs.readFile(backupPath);
    const decompressed = await this.decompress(compressed);
    const backup = JSON.parse(decompressed.toString()) as BackupData;

    const dataString = JSON.stringify(backup.data);
    const checksum = crypto
      .createHash('sha256')
      .update(dataString)
      .digest('hex');

    if (checksum !== backup.checksum) {
      throw new Error('Backup checksum verification failed');
    }

    if (backup.data.localStorage) {
      await this.restoreLocalStorage(backup.data.localStorage);
    }

    if (backup.data.database) {
      await this.restoreDatabase(backup.data.database);
    }

    if (backup.data.preferences) {
      await this.restorePreferences(backup.data.preferences);
    }

    console.log('Backup restoration completed');
  }

  private async restoreLocalStorage(data: Record<string, string>) {
    const windows = BrowserWindow.getAllWindows();
    
    if (windows.length === 0) {
      throw new Error('No window available for localStorage restoration');
    }

    const script = `
      (function() {
        localStorage.clear();
        ${Object.entries(data).map(([key, value]) => 
          `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`
        ).join('\n')}
      })()
    `;

    await windows[0].webContents.executeJavaScript(script);
  }

  private async restoreDatabase(backup: DatabaseBackup) {
    const dbPath = path.join(app.getPath('userData'), 'pasteflow.db');
    
    if (await fs.pathExists(dbPath)) {
      await fs.rename(dbPath, `${dbPath}.old`);
    }

    const db = new Database(dbPath);

    for (const { sql } of backup.schema) {
      if (sql) {
        db.exec(sql);
      }
    }

    for (const [tableName, rows] of Object.entries(backup.data)) {
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(
        `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
      );

      for (const row of rows) {
        stmt.run(...columns.map(col => (row as Record<string, unknown>)[col]));
      }
    }

    db.close();
  }

  private async restorePreferences(prefs: Record<string, unknown>) {
    const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
    await fs.writeJson(prefsPath, prefs, { spaces: 2 });
  }

  private async cleanOldBackups() {
    const files = await fs.readdir(this.backupDir);
    const backups = files
      .filter(f => f.startsWith('pasteflow-backup-'))
      .map(f => ({
        name: f,
        path: path.join(this.backupDir, f),
        stat: fs.statSync(path.join(this.backupDir, f))
      }))
      .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

    const toDelete = backups.slice(10);
    
    for (const backup of toDelete) {
      await fs.remove(backup.path);
      console.log(`Deleted old backup: ${backup.name}`);
    }
  }

  async hasValidBackup(): Promise<boolean> {
    const files = await fs.readdir(this.backupDir);
    return files.some(f => f.startsWith('pasteflow-backup-'));
  }

  async getBackupList(): Promise<BackupInfo[]> {
    const files = await fs.readdir(this.backupDir);
    
    const backups = await Promise.all(
      files
        .filter(f => f.startsWith('pasteflow-backup-'))
        .map(async (filename) => {
          const filepath = path.join(this.backupDir, filename);
          const stat = await fs.stat(filepath);
          
          return {
            filename,
            path: filepath,
            size: stat.size,
            created: stat.mtime,
            compressed: filename.endsWith('.gz')
          };
        })
    );

    return backups.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  private async compress(data: Buffer | string): Promise<Buffer> {
    return await gzip(data);
  }

  private async decompress(data: Buffer): Promise<Buffer> {
    return await gunzip(data);
  }
}