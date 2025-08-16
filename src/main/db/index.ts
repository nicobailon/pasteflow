// Export database components
export { AsyncDatabase, PreparedStatement } from './async-database';
export { ConnectionPool } from './connection-pool';
export { PooledDatabase } from './pooled-database';
export { PooledDatabaseBridge } from './pooled-database-bridge';

// Export types
export type { RunResult } from './async-database';
export type { PoolStats, SqlParameters, QueryResult } from './connection-pool';
export type { PooledDatabaseConfig, PerformanceMetrics } from './pooled-database';
export type { DatabaseBridgeConfig } from './pooled-database-bridge';

// Configuration presets
export {
  HIGH_LOAD_CONFIG,
  STANDARD_CONFIG,
  LIGHT_CONFIG,
  DEVELOPMENT_CONFIG,
  TEST_CONFIG,
  getConfigForEnvironment,
  createCustomConfig,
  getRecommendedConfig
} from './pool-config';

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