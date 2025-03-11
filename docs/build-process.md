# Build Process Documentation

## Overview

This application uses Electron with a separate build process for the main process and renderer process.

## Build Configuration

### Directory Structure

- `dist/`: The main output directory
  - `dist/main/`: Contains compiled main process code (Electron)
  - `dist/renderer/`: Contains compiled renderer process code (React)

### Configuration Files

- `tsconfig.json`: TypeScript configuration for the renderer process
- `tsconfig.main.json`: TypeScript configuration for the main process
- `vite.config.ts`: Vite configuration for building the renderer

## Build Scripts

The following npm scripts are available for building the application:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "npm run build:renderer && npm run build:main",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "electron:dev": "electron .",
    "electron:build": "npm run build && electron-builder",
    "preview": "vite preview"
  }
}
```

## Build Process Flow

1. **Development**:
   - Run `npm run dev` to start the renderer in development mode
   - Run `npm run electron:dev` to start Electron with the development renderer

2. **Production Build**:
   - Run `npm run build` to build both main and renderer processes
     - This first builds the renderer with Vite (`build:renderer`)
     - Then builds the main process with TypeScript (`build:main`)
   - Run `npm run electron:build` to package the application using electron-builder

## Important Notes

- The main process entry point is specified in `package.json` as `"main": "dist/main/main.js"`
- The preload script is located at `dist/main/preload.js`
- All IPC communication between the renderer and main processes is handled through the preload script 