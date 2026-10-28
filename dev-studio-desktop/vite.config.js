import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' is REQUIRED so the built app works from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true
  },
  preview: {
    port: 3000,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true
  }
});
