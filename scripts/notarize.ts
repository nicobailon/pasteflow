import fs from 'node:fs';
import path from 'node:path';

import { notarize } from '@electron/notarize';

// This script is called by electron-builder after signing the app
// It's used for notarizing macOS applications
// Important: Keep CommonJS export shape for electron-builder hook compatibility
type AfterSignParams = {
  appOutDir: string;
  packager: { appInfo: { productFilename: string } };
};

// This function must remain CommonJS-compatible for electron-builder
module.exports = async function (params: AfterSignParams) {
  // Only notarize the app on macOS and when publishing (not during development)
  if (process.platform !== 'darwin' || !process.env.NOTARIZE) {
    console.log('Skipping notarization: Not on macOS or NOTARIZE env var not set');
    return;
  }

  console.log('Notarizing macOS application...');

  // Get necessary app information from package.json
  // Use process.cwd() so this works both from scripts/ and build/scripts/
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const appId: string = pkg.build.appId;

  // Path to the packaged app
  const appPath = path.join(
    params.appOutDir,
    `${params.packager.appInfo.productFilename}.app`,
  );

  if (!fs.existsSync(appPath)) {
    console.error(`Cannot find application at: ${appPath}`);
    return;
  }

  try {
    // Check for required environment variables
    if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.TEAM_ID) {
      console.error('Missing required environment variables for notarization:');
      console.error('- APPLE_ID: Your Apple ID');
      console.error('- APPLE_APP_SPECIFIC_PASSWORD: An app-specific password');
      console.error('- TEAM_ID: Your Apple Developer Team ID');
      console.error('Please set these environment variables and try again.');
      return;
    }

    // Notarize the app
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID!,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
      teamId: process.env.TEAM_ID!,
    });

    console.log(`Successfully notarized ${appPath}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Notarization failed: ${message}`);
    throw error;
  }
};