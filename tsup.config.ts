import { defineConfig } from "tsup";

export default defineConfig([
  // ESM build for Electron main entry
  {
    entry: {
      main: "src/main/main.ts",
    },
    format: ["esm"],
    outDir: "build/main",
    target: "node20",
    sourcemap: true,
    splitting: false,
    shims: true,
    platform: "node",
    treeshake: false,
    clean: true,
    external: [
      // Keep native and heavy deps external; let Electron/Node resolve them
      "better-sqlite3",
      "electron",
      "express",
    ],
    outExtension() {
      return { js: ".mjs" };
    },
  },
  // ESM build for worker runtime artifact
  {
    entry: {
      "db/database-worker": "src/main/db/database-worker.ts",
    },
    format: ["esm"],
    outDir: "build/main",
    target: "node20",
    sourcemap: true,
    splitting: false,
    shims: true,
    platform: "node",
    treeshake: false,
    clean: false,
    external: [
      "better-sqlite3",
      "electron",
      "express",
    ],
    outExtension() {
      return { js: ".mjs" };
    },
  },
  // CJS build for preload (Electron currently loads preload via CommonJS)
  {
    entry: {
      preload: "src/main/preload.ts",
    },
    format: ["cjs"],
    outDir: "build/main",
    target: "node20",
    sourcemap: true,
    splitting: false,
    shims: false,
    platform: "node",
    treeshake: false,
    clean: false,
    external: [
      "electron"
    ],
  },
  // CLI (ESM)
  {
    entry: {
      "index": "cli/src/index.ts",
    },
    format: ["esm"],
    outDir: "cli/dist",
    target: "node20",
    sourcemap: true,
    splitting: false,
    shims: true,
    platform: "node",
    treeshake: false,
    clean: false,
    outExtension() {
      return { js: ".mjs" };
    },
  },
]);
