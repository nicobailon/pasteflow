export type ApiErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PATH_DENIED'
  | 'DB_NOT_INITIALIZED'
  | 'DB_OPERATION_FAILED'
  | 'WORKSPACE_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

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