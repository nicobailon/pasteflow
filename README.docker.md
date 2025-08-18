# Docker Setup for PasteFlow

This guide explains how to use Docker to build PasteFlow binaries with electron-builder. Running the GUI app inside the container is not supported.

## Prerequisites

- Docker 24+
- Docker Compose v2

## Build the image

```bash
docker compose build
```

## Launch a dev shell

```bash
docker compose run --rm pasteflow-dev bash
```

## Inside the container

```bash
# Install dependencies (native rebuilds included)
npm ci

# Package for Linux (container target)
npm run package:linux

# Or the generic packaging command for current platform
npm run package
```

## Notes on platform targets

- Linux packages (AppImage, deb, rpm) are supported inside the container.
- macOS and Windows binaries should be built on their respective host OSes for proper code signing and toolchain support.
- Cross‑compilation from Linux → macOS/Windows is not supported by electron‑builder without additional native tooling and signing credentials.

## Where artifacts go

- Binaries are written to the `release-builds` directory mounted from your host. You can inspect them on the host after the container exits.

```bash
# On host
ls -la release-builds
```

## Permissions (optional)

If your host user needs access to container‑generated files:

```bash
chmod -R 777 release-builds
```

## Development flow with Docker

1. Edit code on your host (the workspace is mounted into the container)
2. Use the container only for packaging/testing packaging steps
3. Run the packaged app on the host

## Related scripts (TypeScript)

- All build/packaging scripts live in `scripts/*.ts` and are executed with `tsx` during development or compiled to CommonJS into `build/scripts` for runtime hooks (e.g., electron‑builder `afterSign`).

## Useful npm scripts

```bash
# Compile TS build scripts to CJS for packaging hooks
npm run build:scripts

# Verify electron-builder configuration
npm run verify-build

# Test end-to-end local packaging on host OS
npm run test-build
