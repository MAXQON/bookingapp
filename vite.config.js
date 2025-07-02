// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['moment'], // Add moment here
  },
  build: {
    // Potentially needed if optimizeDeps.include alone isn't enough
    // rollupOptions: {
    //   external: ['moment'], // Only if you want to completely exclude it from the bundle (advanced)
    // }
  }
});