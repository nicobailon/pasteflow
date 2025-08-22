import { normalizePath } from '@file-ops/path';

export interface ValidationResult {
  valid: boolean;
  sanitizedPath?: string;
  reason?: string;
}

export class PathValidator {
  private allowedBasePaths: Set<string>;
  private blockedPaths: Set<string>;
  
  constructor(workspacePaths: string[]) {
    this.allowedBasePaths = new Set(workspacePaths.map(p => normalizePath(p)));
    this.blockedPaths = new Set([
      '/etc',
      '/sys',
      '/proc',
      '/root',
      '/boot',
      'C:/Windows/System32',
      'C:/Windows/SysWOW64',
      'C:/Windows/System',
      'C:/Windows/Boot',
      // Common sensitive directories - skip in browser environment
    ]);
  }

  validatePath(inputPath: string): ValidationResult {
    // Basic input validation
    if (!inputPath || typeof inputPath !== 'string') {
      return { valid: false, reason: 'INVALID_INPUT' };
    }

    // Check for path traversal patterns
    if (inputPath.includes('..') || inputPath.includes('\0') || inputPath.includes('%00')) {
      return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
    }

    // Normalize the path to prevent bypasses
    let resolved: string;
    try {
      resolved = normalizePath(inputPath);
      if (!resolved) {
        return { valid: false, reason: 'PATH_RESOLUTION_FAILED' };
      }
    } catch {
      return { valid: false, reason: 'PATH_RESOLUTION_FAILED' };
    }

    // Allow-first: if within any allowed base path, allow immediately (including dotfiles)
    if (this.allowedBasePaths.size > 0) {
      const isInWorkspace = [...this.allowedBasePaths]
        .some(basePath => resolved.startsWith(basePath + '/') || resolved === basePath);
      if (isInWorkspace) {
        return { valid: true, sanitizedPath: resolved };
      }
    }

    // Check against blocked paths (for paths outside workspace or when no workspace set)
    for (const blockedPath of this.blockedPaths) {
      if (resolved.startsWith(blockedPath) || this.matchesPattern(resolved, blockedPath)) {
        return { valid: false, reason: 'BLOCKED_PATH' };
      }
    }

    // If workspaces are defined and path is not inside any, deny
    if (this.allowedBasePaths.size > 0) {
      return { valid: false, reason: 'OUTSIDE_WORKSPACE' };
    }

    // No workspace restriction configured: allow if not blocked
    return { valid: true, sanitizedPath: resolved };
  }

  private matchesPattern(filepath: string, pattern: string): boolean {
    // Simple glob-like pattern matching for basic wildcards
    if (pattern.includes('*')) {
      // Escape dots first to ensure they're treated as literal dots
      const regexPattern = pattern
        .replace(/\./g, '\\.')  // Escape dots to match literal dots
        .replace(/\*/g, '[^/\\\\]*')  // Replace * with "any chars except path separators"
        .replace(/\//g, '/')
        .replace(/\\/g, '\\\\');
      
      try {
        return new RegExp(regexPattern).test(filepath);
      } catch {
        return false;
      }
    }
    
    return filepath.startsWith(pattern);
  }

  updateWorkspacePaths(workspacePaths: string[]): void {
    this.allowedBasePaths = new Set(workspacePaths.map(p => normalizePath(p)));
  }

  getAllowedPaths(): string[] {
    return Array.from(this.allowedBasePaths);
  }
}

// Singleton instance to be used across the application
let globalPathValidator: PathValidator | null = null;

export function getPathValidator(workspacePaths?: string[]): PathValidator {
  if (!globalPathValidator || workspacePaths) {
    globalPathValidator = new PathValidator(workspacePaths || []);
  }
  return globalPathValidator;
}