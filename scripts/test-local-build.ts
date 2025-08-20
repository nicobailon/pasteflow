/**
 * Script to test local Electron builds
 * This helps verify that electron-builder is working correctly on your machine
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const platform = process.platform;
const buildType = (process.argv[2] as string | undefined) || platform;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}
function err(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(msg);
}

log('🧪 Testing local Electron build');
log(`System: ${os.platform()} ${os.release()} ${os.arch()}`);
log(`Build type: ${buildType}`);

// Clean previous builds
try {
  log('🧹 Cleaning previous builds...');
  const releasesPath = path.join(__dirname, '..', 'release-builds');
  if (fs.existsSync(releasesPath)) {
    if (platform === 'win32') {
      execSync('rmdir /s /q release-builds', { stdio: 'inherit' });
    } else {
      execSync('rm -rf release-builds', { stdio: 'inherit' });
    }
  }
  log('✅ Clean complete');
} catch {
  log('⚠️ Clean failed, but continuing...');
}

// Run build
try {
  log('🔨 Building Vite app...');
  execSync('npm run build', { stdio: 'inherit' });
  log('✅ Build complete');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  err('❌ Build failed:');
  err(message);
  process.exit(1);
}

// Run packaging
log('📦 Packaging Electron app...');
try {
  let command: string;

  switch (buildType) {
    case 'darwin':
    case 'mac': {
      command = 'npm run package:mac';
      break;
    }
    case 'win32':
    case 'windows':
    case 'win': {
      command = 'npm run package:win';
      break;
    }
    case 'linux': {
      command = 'npm run package:linux';
      break;
    }
    case 'all': {
      command = 'npm run package:all';
      break;
    }
    default: {
      log(`Unknown build type: ${buildType}, using current platform`);
      command = `npm run package:${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'}`;
    }
  }

  log(`Running command: ${command}`);
  execSync(command, { stdio: 'inherit' });
  log('✅ Packaging complete');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  err('❌ Packaging failed:');
  err(message);
  process.exit(1);
}

// Check for output files
log('🔍 Checking for output files...');
const releasesPath = path.join(__dirname, '..', 'release-builds');
if (!fs.existsSync(releasesPath)) {
  err('❌ No release-builds directory found');
  process.exit(1);
}

let files: string[];
try {
  files = fs.readdirSync(releasesPath);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  err('❌ Failed to read release-builds directory:');
  err(message);
  process.exit(1);
}

if (files.length === 0) {
  err('❌ No files found in release-builds directory');
  process.exit(1);
}

log('📃 Files in release-builds directory:');
for (const file of files) {
  const stats = fs.statSync(path.join(releasesPath, file));
  const size = stats.size / (1024 * 1024); // Convert to MB
  log(`- ${file} (${size.toFixed(2)} MB)`);
}

log('\n✅ Build test complete! Your electron-builder setup appears to be working correctly.');
log('You can find your build files in the release-builds directory.');

// Print helpful instructions
log('\n📝 Next steps:');
if (platform === 'darwin') {
  log('- To test the macOS app: open release-builds/PasteFlow.app');
  log('- To create a GitHub release, tag your commit and push:');
  log('  git tag v1.0.0');
  log('  git push origin v1.0.0');
} else if (platform === 'win32') {
  log('- To test the Windows app: run release-builds\\PasteFlow.exe');
  log('- To create a GitHub release, tag your commit and push:');
  log('  git tag v1.0.0');
  log('  git push origin v1.0.0');
} else {
  log('- To test the Linux app: run the AppImage in release-builds/');
  log('- To create a GitHub release, tag your commit and push:');
  log('  git tag v1.0.0');
  log('  git push origin v1.0.0');
}