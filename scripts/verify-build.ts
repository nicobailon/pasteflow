import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function err(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(msg);
}

/**
 * Script to verify electron-builder configuration and ensure it can create proper builds
 */
(function main() {
  log('🔍 Verifying build configuration...');

  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    log(`📦 Package name: ${packageJson.name}`);
    log(`🔢 Version: ${packageJson.version}`);

    if (!packageJson.build) {
      err('❌ No "build" configuration found in package.json');
      process.exit(1);
    }

    log('✅ "build" configuration exists');

    // Check output directory
    const outputDir: string = packageJson.build.directories?.output || 'dist';
    log(`📂 Output directory: ${outputDir}`);

    // Check files configuration
    if (!packageJson.build.files || packageJson.build.files.length === 0) {
      log('⚠️ No "files" configuration found in build config');
    } else {
      log(`✅ "files" configuration exists with ${packageJson.build.files.length} entries`);
    }

    // Check main file
    if (!packageJson.main) {
      err('❌ No "main" field found in package.json');
      process.exit(1);
    }

    log(`✅ Main file: ${packageJson.main}`);
    if (!fs.existsSync(path.join(__dirname, '..', packageJson.main))) {
      err(`❌ Main file "${packageJson.main}" does not exist`);
      process.exit(1);
    }

    log('✅ Main file exists');

    // Check if Vite dist directory exists
    const distDir = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(distDir)) {
      log('✅ "dist" directory exists');
    } else {
      log('⚠️ "dist" directory does not exist. Running build...');
      execSync('npm run build', { stdio: 'inherit' });

      if (!fs.existsSync(distDir)) {
        err('❌ Failed to build the Vite app');
        process.exit(1);
      }

      log('✅ Vite build completed successfully');
    }

    // Print electron-builder version
    try {
      const version = execSync('npx electron-builder --version', {
        encoding: 'utf8',
      }).trim();
      log(`🏗️ electron-builder version: ${version}`);
    } catch (error) {
      err('❌ Failed to get electron-builder version');
      // eslint-disable-next-line no-console
      console.error(error);
    }

    log('\n🚀 Ready to build! Try running one of these commands:');
    log('  npm run package:mac    # Build for macOS');
    log('  npm run package:win    # Build for Windows');
    log('  npm run package:linux  # Build for Linux');
    log('  npm run package:all    # Build for all platforms (requires proper setup)');
  } catch (error) {
    err('❌ Error while verifying build configuration:');
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  }
})();