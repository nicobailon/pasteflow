export { AsyncDatabase, PreparedStatement } from './async-database';
export { SecureDatabase } from './secure-database';
export type { RunResult } from './async-database';

// Re-export types from schemas
export type {
  WorkspaceType,
  WorkspaceCreateType,
  WorkspaceUpdateType,
  FileContentRequestType,
  FileContentResponseType,
  FileSaveType,
  PreferenceSetType,
  PromptType,
  InstructionType,
  InstructionCreateType,
  AuditLogEntryType
} from '../ipc/schemas';