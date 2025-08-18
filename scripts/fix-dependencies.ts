#!/usr/bin/env node

/**
 * This script helps fix dependency issues in the packaged Electron app
 * by ensuring all required modules are properly copied to the application directory.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Define the dependencies we need to ensure are installed
const criticalDependencies = ['ignore', 'tiktoken', 'gpt-3-encoder'] as const;

// Ensure dependencies are installed properly
function fixDependencies(): void {
  try {
    // First, check if we're in the right directory
    const cwd = process.cwd();
    if (!fs.existsSync(path.join(cwd, 'package.json'))) {
      console.error(
        '❌ Error: package.json not found! Please run this script from the PasteFlow source directory.',
      );
      process.exit(1);
    }

    // Install required dependencies
    execSync(`npm install ${criticalDependencies.join(' ')} --no-save`, {
      stdio: 'inherit',
    });

    // Read package.json
    const pkgPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Update build configuration
    if (!packageJson.build) {
      packageJson.build = {};
    }

    packageJson.build.asarUnpack = [
      'node_modules/ignore/**',
      'node_modules/tiktoken/**',
      'node_modules/gpt-3-encoder/**',
    ];

    // Write updated package.json
    fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Updated package.json build.asarUnpack for critical deps');
  } catch (error: any) {
    console.error('❌ Error fixing dependencies:', error?.message || error);
    process.exit(1);
  }
}

// Run the main function
fixDependencies();