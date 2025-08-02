// Simple validation library for IPC handlers
// Since the project doesn't use zod in main.js, we'll create a simple validation system
const { RATE_LIMITS, VALIDATION } = require('../constants/app-constants.js');

class IPCValidator {
  constructor() {
    this.rateLimiter = new Map();
    
    // Rate limiting configuration using centralized constants
    this.rateLimits = {
      'request-file-list': { windowMs: RATE_LIMITS.WINDOW_MS, maxRequests: RATE_LIMITS.REQUESTS.FILE_LIST },
      'request-file-content': { windowMs: RATE_LIMITS.WINDOW_MS, maxRequests: RATE_LIMITS.REQUESTS.FILE_CONTENT },
      'open-docs': { windowMs: RATE_LIMITS.WINDOW_MS, maxRequests: RATE_LIMITS.REQUESTS.OPEN_DOCS },
      'open-folder': { windowMs: RATE_LIMITS.WINDOW_MS, maxRequests: RATE_LIMITS.REQUESTS.OPEN_FOLDER },
      'cancel-file-loading': { windowMs: RATE_LIMITS.WINDOW_MS, maxRequests: RATE_LIMITS.REQUESTS.WORKSPACE_OPERATIONS }
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
    if (value.length === 0 || value.length > VALIDATION.MAX_PATH_LENGTH) return false;
    if (value.includes('..') || value.includes('\0') || value.includes('%00')) return false;
    return true;
  }

  isValidExclusionPatterns(value) {
    if (!this.isArray(value)) return false;
    if (value.length > VALIDATION.MAX_DOC_NAME_LENGTH) return false;
    
    return value.every(pattern => 
      this.isString(pattern) && 
      pattern.length > 0 && 
      pattern.length <= VALIDATION.MAX_PATTERN_LENGTH &&
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
      
      case 'cancel-file-loading':
        return this.validateCancelFileLoadingRequest(data);
      
      case 'open-folder':
        return this.validateOpenFolderRequest(data);
      
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

  validateCancelFileLoadingRequest({ requestId }) {
    // requestId is optional, but if provided must be a string
    if (requestId !== undefined && requestId !== null && !this.isString(requestId)) {
      return {
        success: false,
        error: 'Invalid request ID',
        code: 'INVALID_REQUEST_ID'
      };
    }

    return {
      success: true,
      data: { requestId }
    };
  }

  validateOpenFolderRequest(data) {
    // Open folder has no input parameters, just validate rate limiting
    return {
      success: true,
      data: {}
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
}, RATE_LIMITS.CLEANUP_INTERVAL_MINUTES * 60 * 1000);

module.exports = {
  IPCValidator,
  ipcValidator
};