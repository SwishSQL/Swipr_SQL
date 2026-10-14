import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['xlsx']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/xlsx/, /node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  server: {
    port: 3000,
    host: true,
    // Proxy API calls to the Express backend during local development.
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
});
