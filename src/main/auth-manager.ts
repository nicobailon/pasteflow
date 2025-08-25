import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class AuthManager {
  private readonly configDir = path.join(os.homedir(), '.pasteflow') ;
  private readonly tokenPath = path.join(this.configDir, 'auth.token') ;
  private token: string;

  constructor() {
    this.ensureFiles();
    this.token = this.readToken();
  }

  validate(authorization: string | undefined): boolean {
    if (!authorization) return false;
    return authorization === `Bearer ${this.token}`;
  }

  getToken(): string {
    return this.token;
  }

  private readToken(): string {
    try {
      return fs.readFileSync(this.tokenPath, 'utf8').trim();
    } catch {
      // If read fails for any reason, regenerate a token
      const value = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(this.tokenPath, value + '\n', { mode: 0o600 });
      try { fs.chmodSync(this.tokenPath, 0o600); } catch {}
      return value;
    }
  }

  private ensureFiles(): void {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }
      try { fs.chmodSync(this.configDir, 0o700); } catch {}
      if (!fs.existsSync(this.tokenPath)) {
        const value = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(this.tokenPath, value + '\n', { mode: 0o600 });
      }
      try { fs.chmodSync(this.tokenPath, 0o600); } catch {}
    } catch {
      // Best-effort; API middleware will respond 401 if token cannot be validated
    }
  }
}