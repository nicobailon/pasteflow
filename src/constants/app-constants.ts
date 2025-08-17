/**
 * Centralized application constants for PasteFlow
 * Extracted from magic numbers throughout the codebase
 */

// ==================== FILE PROCESSING ====================

export const FILE_PROCESSING = {
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
  /** Timeout for file content reading operations (seconds) */
  FILE_CONTENT_TIMEOUT_SECONDS: 30,
  /** Cleanup interval for stale file accumulation (minutes) */
  FILE_ACCUMULATION_CLEANUP_MINUTES: 5,
  /** Hash text length limit for request deduplication */
  HASH_TEXT_LENGTH_LIMIT: 1000,
  /** File processing debounce delay (milliseconds) */
  DEBOUNCE_DELAY_MS: 500,
} as const;

// ==================== RATE LIMITING ====================

export const RATE_LIMITS = {
  /** Rate limiting window duration (milliseconds) */
  WINDOW_MS: 60 * 1000, // 60 seconds
  
  /** Request limits per window for different IPC operations */
  REQUESTS: {
    FILE_LIST: 200,  // Increased for preference reads during workspace loading
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
} as const;

// ==================== VALIDATION LIMITS ====================

export const VALIDATION = {
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
} as const;

// ==================== TOKEN COUNTING ====================

export const TOKEN_COUNTING = {
  /** Characters per token estimation ratio */
  CHARS_PER_TOKEN: 4,
  /** Special token to replace in content */
  PROBLEMATIC_TOKEN: '<|endoftext|>',
  /** Minimum text retention ratio after sanitization */
  MIN_TEXT_RETENTION_RATIO: 0.9,
  /** Line-based token estimation multiplier for GPT models */
  WORD_TO_TOKEN_RATIO: 1.3,
  /** Small content threshold for direct character counting */
  SMALL_CONTENT_THRESHOLD: 100,
} as const;

// ==================== WORKER POOL ====================

export const WORKER_POOL = {
  /** Maximum number of workers */
  MAX_WORKERS: 8,
  /** Default worker pool size based on hardware */
  DEFAULT_WORKERS: 4,
  /** Maximum queue size before dropping requests */
  MAX_QUEUE_SIZE: 1000,
  /** Health check timeout (milliseconds) */
  HEALTH_CHECK_TIMEOUT_MS: 1000,
  /** Worker failure window (milliseconds) */
  FAILURE_WINDOW_MS: 5000,
  /** Maximum failures allowed in window before recovery delay */
  MAX_FAILURES_IN_WINDOW: 3,
  /** Worker operation timeout (milliseconds) */
  OPERATION_TIMEOUT_MS: 30_000,
  /** Health monitoring interval (seconds) */
  HEALTH_MONITOR_INTERVAL_SECONDS: 30,
  /** Memory monitoring interval (seconds) */
  MEMORY_MONITOR_INTERVAL_SECONDS: 30,
  /** Memory threshold for worker recycling (bytes) */
  MEMORY_THRESHOLD_BYTES: 500_000_000, // 500MB
  /** Worker initialization timeout (milliseconds) */
  INIT_TIMEOUT_MS: 5000,
  /** Worker ready wait timeout (milliseconds) */
  READY_TIMEOUT_MS: 5000,
  /** Worker recovery timeout (milliseconds) */
  RECOVERY_TIMEOUT_MS: 2000,
  /** Polling interval for worker status checks (milliseconds) */
  STATUS_POLL_INTERVAL_MS: 100,
  /** Job completion wait timeout (milliseconds) */
  JOB_WAIT_TIMEOUT_MS: 10_000,
  /** Required stable iterations for job completion */
  STABLE_ITERATIONS: 3,
  /** Safety check delay (milliseconds) */
  SAFETY_CHECK_DELAY_MS: 10,
  /** Recovery initialization delay (milliseconds) */
  RECOVERY_INIT_DELAY_MS: 50,
  /** Default job priority (lower = higher priority) */
  DEFAULT_PRIORITY: 0,
  /** Background job priority */
  BACKGROUND_PRIORITY: 10,
  /** Batch processing multiplier for pool size */
  BATCH_MULTIPLIER: 2,
} as const;

// ==================== CACHING ====================

export const CACHE = {
  /** Default cache configurations by environment */
  PROFILES: {
    DEVELOPMENT: {
      MAX_MEMORY_MB: 128,
      MAX_ENTRIES: 500,
      MAX_FILE_SIZE_MB: 5,
      TTL_MINUTES: 15,
      COMPRESSION_THRESHOLD_BYTES: 50 * 1024, // 50KB
    },
    PRODUCTION: {
      MAX_MEMORY_MB: 512,
      MAX_ENTRIES: 2000,
      MAX_FILE_SIZE_MB: 20,
      TTL_MINUTES: 60,
      COMPRESSION_THRESHOLD_BYTES: 100 * 1024, // 100KB
    },
    ELECTRON: {
      MAX_MEMORY_MB: 1024,
      MAX_ENTRIES: 5000,
      MAX_FILE_SIZE_MB: 50,
      TTL_MINUTES: 120,
      COMPRESSION_THRESHOLD_BYTES: 200 * 1024, // 200KB
    },
  },
  /** Default enhanced file cache settings */
  DEFAULT: {
    MAX_MEMORY_MB: 256,
    MAX_ENTRIES: 1000,
    MAX_FILE_SIZE_MB: 10,
    TTL_MINUTES: 30,
    COMPRESSION_THRESHOLD_BYTES: 100 * 1024, // 100KB
  },
} as const;

// ==================== MEMORY MONITORING ====================

export const MEMORY = {
  /** Memory usage warning threshold (MB) */
  WARNING_THRESHOLD_MB: 100,
  /** Memory usage critical threshold (MB) */
  CRITICAL_THRESHOLD_MB: 200,
  /** Periodic monitoring interval (milliseconds) */
  MONITOR_INTERVAL_MS: 60_000, // 60 seconds
  /** Bytes per character estimation for JavaScript strings */
  BYTES_PER_CHAR: 2,
  /** Object property memory estimation (bytes) */
  BYTES_PER_PROPERTY: 100,
} as const;

// ==================== PERFORMANCE MONITORING ====================

export const PERFORMANCE = {
  /** Maximum measurements to keep in memory */
  MAX_MEASUREMENTS: 1000,
  /** Performance report age threshold (milliseconds) */
  REPORT_AGE_THRESHOLD_MS: 300_000, // 5 minutes
} as const;

// ==================== UI CONSTANTS ====================

export const UI = {
  /** File tree processing constants */
  TREE: {
    /** Progress initialization value */
    INITIAL_PROGRESS: 0,
    /** Batch size for tree processing */
    BATCH_SIZE: 50,
    /** Batch interval for processing (milliseconds) */
    BATCH_INTERVAL_MS: 1,
    /** Large file threshold for chunked processing */
    LARGE_FILE_THRESHOLD: 1000,
    /** Processing chunk size for large trees (canonical) */
    CHUNK_SIZE: 1000,
    /** Progress completion value */
    COMPLETE_PROGRESS: 100,
    /** Tree update debounce delay (milliseconds) */
    UPDATE_DEBOUNCE_MS: 50,
    /** Default expansion level for directories */
    DEFAULT_EXPANSION_LEVEL: 1,
    /** Maximum element traversal depth */
    MAX_TRAVERSAL_DEPTH: 3,
    /** Default line height approximation (pixels) */
    DEFAULT_LINE_HEIGHT: 20,
    /** Line selection tolerance (pixels) */
    SELECTION_TOLERANCE: 5,
    /** Progress post interval for worker (milliseconds) */
    PROGRESS_POST_INTERVAL_MS: 50,
    /** Minimum progress delta for worker updates (percent) */
    PROGRESS_MIN_DELTA_PERCENT: 5,
    /** Timeout for worker cancellation acknowledgement (milliseconds) */
    CANCEL_TIMEOUT_MS: 2000,
    /** Timeout for worker initialization (milliseconds) */
    INIT_TIMEOUT_MS: 5000,
  },
  
  /** Modal and dialog constants */
  MODAL: {
    /** File view modal merge tolerance for ranges */
    RANGE_MERGE_TOLERANCE: 1,
    /** Binary search threshold for line selection */
    BINARY_SEARCH_THRESHOLD: 3,
    /** Maximum DOM depth for line traversal */
    MAX_DOM_DEPTH: 5,
    /** Virtualization threshold - number of lines before switching to virtualized rendering */
    VIRTUALIZATION_THRESHOLD: 1000,
    /** Throttle delay for DOM queries during drag operations (milliseconds) */
    DOM_QUERY_THROTTLE_MS: 16, // ~60fps
    /** Backoff attempts used by preview/copy to wait for just-finished loads */
    BACKOFF_MAX_ATTEMPTS: 3,
    /** Backoff delay between attempts (milliseconds) */
    BACKOFF_DELAY_MS: 150,
  },
  
  /** Icon sizes */
  ICONS: {
    CHEVRON_SIZE: 16,
  },

  /** Preview streaming housekeeping */
  PREVIEW: {
    /** Maximum entries to retain in tracking sets to prevent memory growth */
    MAX_TRACKED_PATHS: 5000,
    /** Periodic cleanup interval while packing (milliseconds) */
    CLEANUP_INTERVAL_MS: 30_000,
  },
} as const;

// ==================== FEATURE FLAGS ====================

export const FEATURES = {
  /** Enable WebWorker-based progressive Preview generation */
  PREVIEW_WORKER_ENABLED: true,
} as const;
// ==================== DATABASE ====================

export const DATABASE = {
  /** SQLite query limits */
  QUERY_LIMITS: {
    /** Default limit for workspace queries */
    WORKSPACE_LIST: 1,
    /** Bulk operation timeout (milliseconds) */
    BULK_TIMEOUT_MS: 30_000,
  },
  /** Boolean conversion constants */
  BOOLEAN: {
    TRUE: 1,
    FALSE: 0,
  },
  /** Test data generation */
  TEST: {
    /** Number of test files for performance testing */
    BULK_FILE_COUNT: 100,
    /** Large batch size for benchmarks */
    LARGE_BATCH_SIZE: 10_000,
    /** Single operation batch size for benchmarks */
    SINGLE_OP_BATCH_SIZE: 1000,
    /** Complex query batch size */
    COMPLEX_QUERY_BATCH_SIZE: 100,
    /** Maximum file size for test data */
    MAX_TEST_FILE_SIZE: 100_000,
    /** Maximum token count for test data */
    MAX_TEST_TOKEN_COUNT: 1000,
    /** Recursive query limit for testing */
    RECURSIVE_QUERY_LIMIT: 1_000_000,
    /** Timeout expectation for long queries (milliseconds) */
    LONG_QUERY_TIMEOUT_MS: 35_000,
    /** Concurrent operation count for stress testing */
    CONCURRENT_OPS: 50,
    /** Final counter value for concurrent tests */
    FINAL_COUNTER: 50,
    /** Test workspace batch sizes */
    WORKSPACE_BATCH_SIZE: 10,
  },
} as const;

// ==================== WORKSPACE MANAGEMENT ====================

export const WORKSPACE = {
  /** Workspace name generation */
  GENERATION: {
    /** Length of random ID suffix */
    RANDOM_ID_LENGTH: 9, // slice(2, 11) = 9 characters
    /** Random string base for ID generation */
    ID_BASE: 36,
    /** Slice start position for random IDs */
    ID_SLICE_START: 2,
    /** Slice end position for random IDs */
    ID_SLICE_END: 11,
  },
  /** Time simulation for testing */
  SIMULATION: {
    /** Time offset between workspaces (milliseconds) */
    TIME_OFFSET_MS: 1000,
  },
} as const;

// ==================== ELECTRON MAIN PROCESS ====================

export const ELECTRON = {
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
} as const;

// ==================== HASH CALCULATION ====================

export const HASHING = {
  /** Hash calculation constants */
  SHIFT_BITS: 5,
  /** Convert to 32-bit integer mask */
  INTEGER_MASK: 0xFF_FF_FF_FF,
} as const;

// ==================== TIME CONVERSIONS ====================

export const TIME = {
  /** Common time conversion constants */
  MILLISECONDS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  
  /** Computed convenience constants */
  MS_PER_MINUTE: 60 * 1000,
  MS_PER_HOUR: 60 * 60 * 1000,
  
  /** Common timeout values */
  TIMEOUTS: {
    /** Standard debounce delay */
    DEBOUNCE_STANDARD: 300,
    /** Short debounce delay */
    DEBOUNCE_SHORT: 100,
    /** Long debounce delay */
    DEBOUNCE_LONG: 500,
    /** Network request timeout */
    NETWORK_REQUEST: 30_000,
    /** File operation timeout */
    FILE_OPERATION: 10_000,
  },
} as const;

// ==================== PRIORITY LEVELS ====================

export const PRIORITY = {
  /** Job priority levels (lower number = higher priority) */
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 5,
  LOW: 8,
  BACKGROUND: 10,
} as const;

// ==================== TREE SORTING ====================

export const TREE_SORTING = {
  /** Maximum entries in the sorting cache */
  CACHE_MAX_ENTRIES: 1000,
  /** Time-to-live for cache entries (milliseconds) */
  TTL_MS: 300_000, // 5 minutes
} as const;

// ==================== TREE FLATTEN CACHE ====================

export const TREE_FLATTEN_CACHE = {
  /** Maximum entries in the flatten cache */
  MAX_ENTRIES: 16,
  /** Time-to-live for cache entries (milliseconds) */
  TTL_MS: 300_000, // 5 minutes
} as const;