import { execSync } from 'node:child_process';

(async () => {
  try {
    execSync('npx tsc -p tsconfig.main.json', { stdio: 'inherit' });

    // No runtime assets need to be copied currently
    // The database-worker.js is only used by AsyncDatabase which is not in use

    console.log('Main TS compiled to CommonJS at build/main');
    process.exit(0);
  } catch (e: any) {
    console.error('Failed to compile main TS:', e?.message || e);
    process.exit(1);
  }
})();