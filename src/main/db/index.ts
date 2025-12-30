export { DatabaseBridge } from './database-bridge';
export { PasteFlowDatabase } from './database-implementation';
export type { WorkspaceRecord, PreferenceRecord, InstructionRow } from './types';

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