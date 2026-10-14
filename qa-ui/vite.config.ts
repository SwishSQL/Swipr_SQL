import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Quality UI is its own small app (Tailwind 4) served by Swipr under /qa/.
export default defineConfig({
  base: '/qa/',
  plugins: [react(), tailwindcss()],
  css: { postcss: { plugins: [] } },   // do not pick up Swipr's Tailwind-3 postcss config from the parent folder
  build: { outDir: '../qa-ui-dist', emptyOutDir: true },
});
