// Simple validation library for IPC handlers
// Since the project doesn't use zod in main.js, we'll create a simple validation system

class IPCValidator {
  constructor() {
    this.rateLimiter = new Map();
    
    // Rate limiting configuration
    this.rateLimits = {
      'request-file-list': { windowMs: 60000, maxRequests: 100 },
      'request-file-content': { windowMs: 60000, maxRequests: 500 },
      'open-docs': { windowMs: 60000, maxRequests: 20 },
      'open-folder': { windowMs: 60000, maxRequests: 20 }
    };
  }

  // Basic type validation helpers
  isString(value) {
    return typeof value === 'string';
  }

  isArray(value) {
    return Array.isArray(value);
  }

  isValidPath(value) {
    if (!this.isString(value)) return false;
    if (value.length === 0 || value.length > 1000) return false;
    if (value.includes('..') || value.includes('\0') || value.includes('%00')) return false;
    return true;
  }

  isValidExclusionPatterns(value) {
    if (!this.isArray(value)) return false;
    if (value.length > 50) return false;
    
    return value.every(pattern => 
      this.isString(pattern) && 
      pattern.length > 0 && 
      pattern.length <= 200 &&
      !pattern.includes('\0')
    );
  }

  isValidDocName(value) {
    if (!this.isString(value)) return false;
    // Only allow specific document formats and prevent path traversal
    return /^[a-zA-Z0-9._-]+\.(md|txt|pdf)$/i.test(value);
  }

  // Rate limiting
  checkRateLimit(senderId, operation) {
    const config = this.rateLimits[operation];
    if (!config) return true; // No rate limit configured

    const now = Date.now();
    const key = `${senderId}-${operation}`;
    
    if (!this.rateLimiter.has(key)) {
      this.rateLimiter.set(key, { count: 1, windowStart: now });
      return true;
    }

    const limiter = this.rateLimiter.get(key);
    
    // Reset window if expired
    if (now - limiter.windowStart > config.windowMs) {
      limiter.count = 1;
      limiter.windowStart = now;
      return true;
    }

    // Check if over limit
    if (limiter.count >= config.maxRequests) {
      return false;
    }

    limiter.count++;
    return true;
  }

  // Main validation method
  validate(operation, data, event) {
    // Rate limiting check
    if (!this.checkRateLimit(event.sender.id, operation)) {
      return {
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED'
      };
    }

    // Operation-specific validation
    switch (operation) {
      case 'request-file-list':
        return this.validateFileListRequest(data);
      
      case 'request-file-content':
        return this.validateFileContentRequest(data);
      
      case 'open-docs':
        return this.validateOpenDocsRequest(data);
      
      default:
        return { success: true, data };
    }
  }

  validateFileListRequest({ folderPath, exclusionPatterns }) {
    if (!this.isValidPath(folderPath)) {
      return {
        success: false,
        error: 'Invalid folder path',
        code: 'INVALID_FOLDER_PATH'
      };
    }

    if (exclusionPatterns !== undefined && !this.isValidExclusionPatterns(exclusionPatterns)) {
      return {
        success: false,
        error: 'Invalid exclusion patterns',
        code: 'INVALID_EXCLUSION_PATTERNS'
      };
    }

    return {
      success: true,
      data: {
        folderPath: folderPath.trim(),
        exclusionPatterns: (exclusionPatterns || []).map(p => p.trim())
      }
    };
  }

  validateFileContentRequest({ filePath }) {
    if (!this.isValidPath(filePath)) {
      return {
        success: false,
        error: 'Invalid file path',
        code: 'INVALID_FILE_PATH'
      };
    }

    return {
      success: true,
      data: { filePath: filePath.trim() }
    };
  }

  validateOpenDocsRequest({ docName }) {
    if (!this.isValidDocName(docName)) {
      return {
        success: false,
        error: 'Invalid document name',
        code: 'INVALID_DOCUMENT_NAME'
      };
    }

    return {
      success: true,
      data: { docName: docName.trim() }
    };
  }

  // Cleanup old rate limiting entries
  cleanupRateLimiter() {
    const now = Date.now();
    const oldEntries = [];

    for (const [key, limiter] of this.rateLimiter.entries()) {
      // Find the maximum window time
      const maxWindow = Math.max(...Object.values(this.rateLimits).map(r => r.windowMs));
      
      if (now - limiter.windowStart > maxWindow * 2) {
        oldEntries.push(key);
      }
    }

    for (const key of oldEntries) {
      this.rateLimiter.delete(key);
    }
  }
}

// Create singleton instance
const ipcValidator = new IPCValidator();

// Cleanup rate limiter every 5 minutes
setInterval(() => {
  ipcValidator.cleanupRateLimiter();
}, 5 * 60 * 1000);

module.exports = {
  IPCValidator,
  ipcValidator
};