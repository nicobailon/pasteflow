// Mock for better-sqlite3-loader to bypass Electron check
import MockDatabase from '../../../__mocks__/better-sqlite3';

export type { Database, Statement, RunResult } from 'better-sqlite3';

export function getBetterSqlite3(): typeof import('better-sqlite3') {
  // Return the mocked better-sqlite3
  return MockDatabase as unknown as typeof import('better-sqlite3');
}