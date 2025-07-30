export interface ErrorContext {
  operation: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export interface RecoverySuggestion {
  title: string;
  action: string;
  severity: 'info' | 'warning' | 'error';
}

export class ApplicationError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly suggestions: RecoverySuggestion[];

  constructor(
    message: string,
    code: string,
    context: ErrorContext,
    suggestions: RecoverySuggestion[] = []
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.context = context;
    this.suggestions = suggestions;
  }
}

export const ERROR_CODES = {
  PATH_VALIDATION_FAILED: 'PATH_VALIDATION_FAILED',
  FILE_LOADING_FAILED: 'FILE_LOADING_FAILED',
  WORKSPACE_SAVE_FAILED: 'WORKSPACE_SAVE_FAILED',
  WORKSPACE_LOAD_FAILED: 'WORKSPACE_LOAD_FAILED',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
  IPC_COMMUNICATION_FAILED: 'IPC_COMMUNICATION_FAILED',
} as const;

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApplicationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

export function getRecoverySuggestions(errorCode: string): RecoverySuggestion[] {
  switch (errorCode) {
    case ERROR_CODES.PATH_VALIDATION_FAILED: {
      return [
        {
          title: 'Check Path',
          action: 'Ensure the selected path exists and you have read permissions',
          severity: 'warning'
        },
        {
          title: 'Security Restriction',
          action: 'System directories and sensitive paths are blocked for security',
          severity: 'info'
        }
      ];
    }

    case ERROR_CODES.FILE_LOADING_FAILED: {
      return [
        {
          title: 'Try Again',
          action: 'Select the folder again to retry loading files',
          severity: 'info'
        },
        {
          title: 'Check Permissions',
          action: 'Ensure you have read access to all files in the directory',
          severity: 'warning'
        }
      ];
    }

    case ERROR_CODES.MEMORY_LIMIT_EXCEEDED: {
      return [
        {
          title: 'Too Many Files',
          action: 'Use exclusion patterns to filter out unnecessary files',
          severity: 'warning'
        },
        {
          title: 'Select Subdirectory',
          action: 'Try selecting a more specific subdirectory instead',
          severity: 'info'
        }
      ];
    }

    case ERROR_CODES.WORKSPACE_SAVE_FAILED: {
      return [
        {
          title: 'Storage Full',
          action: 'Check if browser storage is full and clear if needed',
          severity: 'warning'
        },
        {
          title: 'Try Different Name',
          action: 'Try saving the workspace with a different name',
          severity: 'info'
        }
      ];
    }

    default: {
      return [
        {
          title: 'Restart Application',
          action: 'Try restarting the application to resolve the issue',
          severity: 'info'
        }
      ];
    }
  }
}

export function logError(error: unknown, context: ErrorContext): void {
  const errorInfo = {
    message: getErrorMessage(error),
    code: error instanceof ApplicationError ? error.code : 'UNKNOWN',
    context,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString()
  };

  console.error('[Error]', errorInfo);

  // In production, this would send to a telemetry service
  if (typeof window !== 'undefined' && window.electronTelemetry) {
    window.electronTelemetry.logError(errorInfo);
  }
}

declare global {
  interface Window {
    electronTelemetry?: {
      logError: (error: unknown) => void;
      logEvent: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}