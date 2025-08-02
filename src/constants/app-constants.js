/**
 * CommonJS version of app constants for use in main.js
 * This is a subset of the TypeScript constants needed by the main process
 */

// ==================== FILE PROCESSING ====================

const FILE_PROCESSING = {
  /** Maximum file size to read (5MB) */
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  /** Directory scanning batch size */
  BATCH_SIZE: 50,
  /** Maximum directories to process per batch */
  MAX_DIRS_PER_BATCH: 10,
  /** Maximum depth for directory traversal to prevent infinite recursion */
  MAX_DEPTH: 20,
  /** Timeout for file processing operations (milliseconds) */
  PROCESSING_TIMEOUT_MS: 100,
  /** Cleanup interval for stale file accumulation (minutes) */
  FILE_ACCUMULATION_CLEANUP_MINUTES: 5,
};

// ==================== TOKEN COUNTING ====================

const TOKEN_COUNTING = {
  /** Characters per token estimation ratio */
  CHARS_PER_TOKEN: 4,
  /** Special token to replace in content */
  PROBLEMATIC_TOKEN: '<|endoftext|>',
  /** Minimum text retention ratio after sanitization */
  MIN_TEXT_RETENTION_RATIO: 0.9,
};

// ==================== ELECTRON MAIN PROCESS ====================

const ELECTRON = {
  /** Browser window settings */
  WINDOW: {
    /** Default window width */
    WIDTH: 1200,
    /** Default window height */
    HEIGHT: 800,
    /** Development reload delay (milliseconds) */
    DEV_RELOAD_DELAY_MS: 1000,
    /** DevTools open mode */
    DEVTOOLS_MODE: 'detach',
  },
  
  /** Development server settings */
  DEV_SERVER: {
    /** Default development server port */
    PORT: 3000,
    /** Default development server URL */
    URL: 'http://localhost:3000',
  },
  
  /** Binary file detection constants */
  BINARY_DETECTION: {
    /** Control character threshold for binary detection */
    CONTROL_CHAR_THRESHOLD: 50,
    /** Character code ranges for control characters */
    CONTROL_RANGES: {
      NULL_TO_BACKSPACE: { start: 0, end: 8 },
      VERTICAL_TAB: 11,
      FORM_FEED: 12,
      SHIFT_OUT_TO_UNIT_SEPARATOR: { start: 14, end: 31 },
      DELETE: 127,
      EXTENDED_ASCII: { start: 128, end: 255 },
    },
    /** Allowed control characters */
    ALLOWED_CONTROL_CHARS: {
      TAB: 9,
      LINE_FEED: 10,
      CARRIAGE_RETURN: 13,
    },
  },
};

// ==================== RATE LIMITING ====================

const RATE_LIMITS = {
  /** Rate limiting window duration (milliseconds) */
  WINDOW_MS: 60 * 1000, // 60 seconds
  
  /** Request limits per window for different IPC operations */
  REQUESTS: {
    FILE_LIST: 100,
    FILE_CONTENT: 500,
    OPEN_DOCS: 20,
    OPEN_FOLDER: 20,
    WORKSPACE_OPERATIONS: 50,
    PROMPT_OPERATIONS: 30,
    STATE_OPERATIONS: 20,
    GENERAL: 10,
  },
  
  /** Cleanup interval for rate limiter (minutes) */
  CLEANUP_INTERVAL_MINUTES: 5,
};

// ==================== VALIDATION LIMITS ====================

const VALIDATION = {
  /** Maximum path length for security validation */
  MAX_PATH_LENGTH: 1000,
  /** Maximum workspace name length */
  MAX_WORKSPACE_NAME_LENGTH: 255,
  /** Maximum pattern length for file exclusion */
  MAX_PATTERN_LENGTH: 200,
  /** Maximum document name length */
  MAX_DOC_NAME_LENGTH: 50,
  /** Minimum workspace name length */
  MIN_WORKSPACE_NAME_LENGTH: 1,
};

module.exports = {
  FILE_PROCESSING,
  TOKEN_COUNTING,
  ELECTRON,
  RATE_LIMITS,
  VALIDATION,
};