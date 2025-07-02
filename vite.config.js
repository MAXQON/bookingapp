// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Add or update the 'base' option
  base: '/bookingapp/', // IMPORTANT: This should be your repository name surrounded by slashes
  optimizeDeps: {
    include: ['moment', 'moment-timezone'],
  },
  build: {
    // Potentially needed if optimizeDeps.include alone isn't enough
    // rollupOptions: {
    //   external: ['moment', 'moment-timezone'],
    // }
  }
});