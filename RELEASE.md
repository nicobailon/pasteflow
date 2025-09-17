# Building and Releasing PasteFlow

This document explains how to build and release PasteFlow for distribution.

## Recent Changes

- Agent template scaffolding has been removed. Use `edit.diff` to scaffold files as needed.
- The `file` agent tool now supports write/move/delete operations with preview/apply gating, so builds should include updated permissions when enabling file writes.

## Building the Application Locally

To build the application for local testing:

```bash
npm run build-electron
```

This will:

1. Build the React app with Vite
2. Compile Electron main/preload TypeScript to CommonJS (build/main)
3. Compile packaging hooks to CommonJS (build/scripts)
4. Package the application with electron-builder

The packaged application will be available in the `release-builds` directory.

## Creating a Release

To create a release version for distribution:

```bash
# For a private release without publishing
npm run package

# For a GitHub release (requires GitHub token)
npm run release
```

### Platform-Specific Notes

#### macOS

For macOS builds, you may need to sign and notarize the application for distribution:

1. Set up the following environment variables:

   ```bash
   export APPLE_ID=your.apple.id@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password
   export TEAM_ID=your-team-id
   export NOTARIZE=true
   ```

2. Run the release command:
   ```bash
   npm run release
   ```

#### Windows

For Windows builds, you'll get:

- NSIS installer (.exe)
- Portable version (.exe)

#### Linux

For Linux builds, you'll get:

- AppImage (.AppImage)
- Debian package (.deb)
- RPM package (.rpm)

## Common Issues and Solutions

### Asset Loading Issues

If you encounter blank screens or resource loading errors:

1. Check if the app is properly finding the assets
2. The issue might be related to how paths are resolved in the packaged app
3. The build process handles resource paths for Electron automatically

### macOS Specific Issues

For notarization issues:

- Make sure you have the correct environment variables set
- You may need to create an app-specific password in your Apple ID account

### Windows/Linux Specific Issues

- For Linux, ensure you have the necessary build dependencies installed
- For Windows, ensure you have the appropriate certificate if you want to sign the application
