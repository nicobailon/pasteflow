/* eslint-disable @typescript-eslint/no-var-requires */
import type BetterSqlite3 from 'better-sqlite3';
import { createRequire } from 'node:module';

// Local require compatible with CJS and ESM builds
const nodeRequire: NodeJS.Require = (typeof module !== 'undefined' && (module as any).require)
  ? (module as any).require.bind(module)
  : createRequire(import.meta.url);

export type { Database, Statement, RunResult } from 'better-sqlite3';

export function getBetterSqlite3(): typeof import('better-sqlite3') {
  if (!process.versions?.electron) {
    throw new Error('better-sqlite3 must be loaded from the Electron main/worker process. Launch via Electron (npm run dev:electron or npm start).');
  }
   
  const mod = nodeRequire('better-sqlite3') as typeof import('better-sqlite3');

  // Optional native diagnostic logs: set PASTEFLOW_NATIVE_DEBUG=1
  if (process.env.PASTEFLOW_NATIVE_DEBUG === '1') {
    try {
       
      console.log('Native ABI diagnostics', {
        electron: process.versions.electron,
        node: process.versions.node,
        v8: process.versions.v8,
        modules: process.versions.modules
      });

      const resolvedJs = nodeRequire.resolve('better-sqlite3');
       
      console.log('better-sqlite3 JS entry:', resolvedJs);

      // Try to locate the loaded native .node path from process report
      const report = (process as unknown as { report?: { getReport?: () => { sharedObjects?: string[] } } }).report?.getReport?.();
      const sharedObjects: string[] | undefined = report?.sharedObjects;
      const nativePath = sharedObjects?.find((p) => p.includes('better_sqlite3.node'));
       
      console.log('better-sqlite3 native binary:', nativePath ?? 'unknown');
    } catch {
      // ignore diagnostics errors
    }
  }

  return mod;
}
