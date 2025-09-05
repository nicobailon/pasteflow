import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [],
      },
    }),
    wasm(),
    topLevelAwait(),
    tsconfigPaths()
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait(), tsconfigPaths()]
  },
  optimizeDeps: {
    exclude: ['tiktoken'],
    include: ['tiktoken/lite']
  },
  build: {
    rollupOptions: {
      output: {
        // Ensure workers are properly bundled
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/wasm/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
  ,
  server: {
    proxy: {
      // Pass through /api/v1 to Electron's local HTTP server during dev
      '/api/v1': {
        target: 'http://127.0.0.1:5839',
        changeOrigin: true,
      },
      // Map the SDK default /api/chat -> backend /api/v1/chat for convenience
      '/api/chat': {
        target: 'http://127.0.0.1:5839',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/chat(.*)$/i, '/api/v1/chat$1'),
      },
    },
  }
});
