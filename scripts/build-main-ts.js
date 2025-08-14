#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
  try {
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    await ensureDir(destDir);
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

(async () => {
  try {
    execSync('npx tsc -p tsconfig.main.json', { stdio: 'inherit' });

    // Copy runtime assets required by compiled main layer
    const assets = [
      ['src/main/db/database-worker.js', 'build/main/db/database-worker.js'],
      ['src/main/db/schema.sql', 'build/main/db/schema.sql'],
    ];
    for (const [src, dest] of assets) {
      if (fs.existsSync(src)) {
        await copyFile(src, dest);
      }
    }
    // Copy migrations directory
    await copyDir('src/main/db/migrations', 'build/main/db/migrations');

    console.log('Main TS compiled to CommonJS at build/main');
    process.exit(0);
  } catch (e) {
    console.error('Failed to compile main TS:', e?.message || e);
    process.exit(1);
  }
})();

