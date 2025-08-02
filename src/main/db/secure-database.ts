import { AsyncDatabase } from './async-database';
import * as keytar from 'keytar';
import * as crypto from 'crypto';
import { machineIdSync } from 'node-machine-id';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SecureDatabase {
  private db!: AsyncDatabase;
  private encryptionKey!: string;

  static async create(dbPath: string): Promise<SecureDatabase> {
    const instance = new SecureDatabase();
    await instance.initialize(dbPath);
    return instance;
  }

  private async initialize(dbPath: string) {
    // Derive encryption key
    this.encryptionKey = await this.deriveEncryptionKey();
    
    // Create encrypted database
    this.db = new AsyncDatabase(dbPath, {
      encryptionKey: this.encryptionKey
    });
    
    // Initialize schema if needed
    await this.initializeSchema();
  }

  private async deriveEncryptionKey(): Promise<string> {
    const SERVICE_NAME = 'com.pasteflow.app';
    const ACCOUNT_NAME = 'db-encryption-key';
    
    // Try to get existing key from macOS Keychain
    let baseSecret = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    
    if (!baseSecret) {
      // Generate new key on first run
      const newKey = crypto.randomBytes(32);
      baseSecret = newKey.toString('base64');
      
      // Store in Keychain
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, baseSecret);
      
      console.log('Generated new database encryption key');
    }
    
    // Derive key with device-specific salt
    const deviceSalt = this.getDeviceSalt();
    const derivedKey = crypto.pbkdf2Sync(
      baseSecret,
      deviceSalt,
      100000,  // iterations
      32,      // key length
      'sha256'
    );
    
    return derivedKey.toString('hex');
  }

  private getDeviceSalt(): Buffer {
    // Combine multiple device-specific identifiers
    const deviceId = machineIdSync();
    const username = os.userInfo().username;
    const hostname = os.hostname();
    
    return crypto.createHash('sha256')
      .update(deviceId)
      .update(username)
      .update(hostname)
      .update('pasteflow-v2-salt')
      .digest();
  }

  private async initializeSchema() {
    // Check if schema exists
    const version = await this.db.get<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    ).catch(() => null);
    
    if (!version) {
      // Load and execute schema
      const schemaSQL = await fs.readFile(
        path.join(__dirname, 'schema.sql'),
        'utf8'
      );
      
      await this.db.exec(schemaSQL);
      console.log('Database schema initialized');
    }
  }

  // Delegate database operations
  get database(): AsyncDatabase {
    return this.db;
  }

  // Workspace operations
  async createWorkspace(name: string, folderPath: string, state: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.run(
      'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
      [id, name, folderPath, JSON.stringify(state)]
    );
    return id;
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const row = await this.db.get<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = ?',
      [id]
    );
    
    if (!row) return undefined;
    
    return {
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      state: JSON.parse(row.state_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed
    };
  }

  async updateWorkspace(id: string, state: Record<string, unknown>): Promise<void> {
    await this.db.run(
      'UPDATE workspaces SET state_json = ?, last_accessed = strftime("%s", "now") WHERE id = ?',
      [JSON.stringify(state), id]
    );
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const rows = await this.db.all<WorkspaceRow>(
      'SELECT * FROM workspaces ORDER BY last_accessed DESC'
    );
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      state: JSON.parse(row.state_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed
    }));
  }

  // File operations
  async saveFileContent(workspaceId: string, filePath: string, content: string, tokenCount?: number): Promise<void> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Save content if new
    const existing = await this.db.get(
      'SELECT hash FROM file_contents WHERE hash = ?',
      [hash]
    );
    
    if (!existing) {
      const compressed = await this.compressContent(content);
      await this.db.run(
        'INSERT INTO file_contents (hash, content, original_size, compressed_size, compression_ratio) VALUES (?, ?, ?, ?, ?)',
        [hash, compressed, content.length, compressed.length, compressed.length / content.length]
      );
    }
    
    // Update file metadata
    await this.db.run(
      `INSERT OR REPLACE INTO files (path, workspace_id, content_hash, size, is_binary, token_count, last_modified)
       VALUES (?, ?, ?, ?, ?, ?, strftime("%s", "now"))`,
      [filePath, workspaceId, hash, content.length, 0, tokenCount || null]
    );
  }

  async getFileContent(workspaceId: string, filePath: string): Promise<string | null> {
    const file = await this.db.get<{ content_hash: string }>(
      'SELECT content_hash FROM files WHERE workspace_id = ? AND path = ?',
      [workspaceId, filePath]
    );
    
    if (!file) return null;
    
    const content = await this.db.get<{ content: Buffer }>(
      'SELECT content FROM file_contents WHERE hash = ?',
      [file.content_hash]
    );
    
    if (!content) return null;
    
    return this.decompressContent(content.content);
  }

  // Preference operations
  async getPreference(key: string): Promise<unknown> {
    const row = await this.db.get<{ value: string; encrypted: number }>(
      'SELECT value, encrypted FROM preferences WHERE key = ?',
      [key]
    );
    
    if (!row) return undefined;
    
    const value = row.encrypted ? await this.decrypt(row.value) : row.value;
    return JSON.parse(value);
  }

  async setPreference(key: string, value: unknown, encrypted = false): Promise<void> {
    const jsonValue = JSON.stringify(value);
    const storedValue = encrypted ? await this.encrypt(jsonValue) : jsonValue;
    
    await this.db.run(
      'INSERT OR REPLACE INTO preferences (key, value, encrypted) VALUES (?, ?, ?)',
      [key, storedValue, encrypted ? 1 : 0]
    );
  }

  // Compression helpers
  private async compressContent(content: string): Promise<Buffer> {
    const { promisify } = await import('util');
    const zlib = await import('zlib');
    const deflate = promisify(zlib.deflate);
    return deflate(Buffer.from(content, 'utf8'));
  }

  private async decompressContent(compressed: Buffer): Promise<string> {
    const { promisify } = await import('util');
    const zlib = await import('zlib');
    const inflate = promisify(zlib.inflate);
    const decompressed = await inflate(compressed);
    return decompressed.toString('utf8');
  }

  // Additional helpers for state handlers
  async saveFileContentByHash(content: string, filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Save content if new
    const existing = await this.db.get(
      'SELECT hash FROM file_contents WHERE hash = ?',
      [hash]
    );
    
    if (!existing) {
      const compressed = await this.compressContent(content);
      await this.db.run(
        'INSERT INTO file_contents (hash, content, original_size, compressed_size, compression_ratio) VALUES (?, ?, ?, ?, ?)',
        [hash, compressed, content.length, compressed.length, compressed.length / content.length]
      );
    }
    
    return hash;
  }

  async getContentByHash(hash: string): Promise<string> {
    const content = await this.db.get<{ content: Buffer }>(
      'SELECT content FROM file_contents WHERE hash = ?',
      [hash]
    );
    
    if (!content) {
      throw new Error(`Content not found for hash: ${hash}`);
    }
    
    return this.decompressContent(content.content);
  }

  async encryptValue(value: string): Promise<string> {
    return this.encrypt(value);
  }

  async decryptValue(value: string): Promise<string> {
    return this.decrypt(value);
  }

  // Encryption helpers
  private async encrypt(text: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private async decrypt(text: string): Promise<string> {
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

// Type definitions
interface WorkspaceRow {
  id: string;
  name: string;
  folder_path: string;
  state_json: string;
  created_at: number;
  updated_at: number;
  last_accessed: number;
}

interface WorkspaceRecord {
  id: string;
  name: string;
  folderPath: string;
  state: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
}