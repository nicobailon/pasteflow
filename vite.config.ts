import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  worker: {
    format: 'es',
    plugins: [wasm(), topLevelAwait()]
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
});