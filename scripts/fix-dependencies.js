#!/usr/bin/env node

/**
 * This script helps fix dependency issues in the packaged Electron app
 * by ensuring all required modules are properly copied to the application directory.
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Define the dependencies we need to ensure are installed
const criticalDependencies = ["ignore", "tiktoken", "gpt-3-encoder"];

// Get the application path (platform-dependent)
function getAppResourcesPath() {
  const platform = process.platform;
  let appPath;

  try {
    if (platform === "darwin") {
      // macOS
      const homeDir = process.env.HOME;
      const appDir =
        "/Applications/PasteFlow.app/Contents/Resources/app.asar.unpacked";
      appPath = path.join(appDir, "node_modules");
    } else if (platform === "win32") {
      // Windows
      const programFiles = process.env["ProgramFiles"];
      appPath = path.join(
        programFiles,
        "PasteFlow",
        "resources",
        "app.asar.unpacked",
        "node_modules",
      );
    } else {
      // Linux
      appPath = "/usr/lib/pasteflow/resources/app.asar.unpacked/node_modules";
    }

    return appPath;
  } catch (error) {
    console.error("❌ Could not determine application path:", error.message);
    return null;
  }
}

// Ensure dependencies are installed properly
function fixDependencies() {
  try {
    // First, check if we're in the right directory
    if (!fs.existsSync("./package.json")) {
      console.error(
        "❌ Error: package.json not found! Please run this script from the PasteFlow source directory.",
      );
      process.exit(1);
    }

    // Install required dependencies
    execSync("npm install ignore tiktoken gpt-3-encoder --no-save", {
      stdio: "inherit",
    });

    // Read package.json
    const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));

    // Update build configuration
    if (!packageJson.build) {
      packageJson.build = {};
    }

    packageJson.build.asarUnpack = [
      "node_modules/ignore/**",
      "node_modules/tiktoken/**",
      "node_modules/gpt-3-encoder/**",
    ];

    // Write updated package.json
    fs.writeFileSync("./package.json", JSON.stringify(packageJson, null, 2));
  } catch (error) {
    console.error("❌ Error fixing dependencies:", error.message);
  }
}

// Run the main function
fixDependencies();
