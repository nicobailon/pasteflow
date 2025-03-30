/**
 * Script to verify electron-builder configuration and ensure it can create proper builds
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

console.log("🔍 Verifying build configuration...");

// Check that package.json exists and has the correct build configuration
try {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
  );

  console.log("📦 Package name:", packageJson.name);
  console.log("🔢 Version:", packageJson.version);

  if (!packageJson.build) {
    console.error('❌ No "build" configuration found in package.json');
    process.exit(1);
  }

  console.log('✅ "build" configuration exists');

  // Check output directory
  const outputDir = packageJson.build.directories?.output || "dist";
  console.log("📂 Output directory:", outputDir);

  // Check files configuration
  if (!packageJson.build.files || packageJson.build.files.length === 0) {
    console.warn('⚠️ No "files" configuration found in build config');
  } else {
    console.log(
      '✅ "files" configuration exists with',
      packageJson.build.files.length,
      "entries",
    );
  }

  // Check main file
  if (!packageJson.main) {
    console.error('❌ No "main" field found in package.json');
    process.exit(1);
  }

  console.log("✅ Main file:", packageJson.main);
  if (!fs.existsSync(path.join(__dirname, "..", packageJson.main))) {
    console.error(`❌ Main file "${packageJson.main}" does not exist`);
    process.exit(1);
  }

  console.log("✅ Main file exists");

  // Check if Vite dist directory exists
  if (fs.existsSync(path.join(__dirname, "../dist"))) {
    console.log('✅ "dist" directory exists');
  } else {
    console.log('⚠️ "dist" directory does not exist. Running build...');
    execSync("npm run build", { stdio: "inherit" });

    if (!fs.existsSync(path.join(__dirname, "../dist"))) {
      console.error("❌ Failed to build the Vite app");
      process.exit(1);
    }

    console.log("✅ Vite build completed successfully");
  }

  // Print electron-builder version
  try {
    const version = execSync("npx electron-builder --version", {
      encoding: "utf8",
    }).trim();
    console.log("🏗️ electron-builder version:", version);
  } catch (error) {
    console.error("❌ Failed to get electron-builder version");
    console.error(error);
  }

  console.log("\n🚀 Ready to build! Try running one of these commands:");
  console.log("  npm run package:mac    # Build for macOS");
  console.log("  npm run package:win    # Build for Windows");
  console.log("  npm run package:linux  # Build for Linux");
  console.log(
    "  npm run package:all    # Build for all platforms (requires proper setup)",
  );
} catch (error) {
  console.error("❌ Error while verifying build configuration:");
  console.error(error);
  process.exit(1);
}
