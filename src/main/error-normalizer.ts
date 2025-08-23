export type ApiErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PATH_DENIED'
  | 'DB_NOT_INITIALIZED'
  | 'DB_OPERATION_FAILED'
  | 'WORKSPACE_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'BINARY_FILE'
  | 'NO_ACTIVE_WORKSPACE'
  | 'INTERNAL_ERROR'
  // Phase 4 additions
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_TIMEOUT'
  | 'INDEX_NOT_READY'
  | 'SEARCH_TOO_BROAD';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function toApiError(code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { error: { code, message, details } };
}

export function ok<T>(data: T): { data: T } {
  return { data };
}