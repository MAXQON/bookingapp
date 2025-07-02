// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/bookingapp/', // Keep this, as it fixed your previous deployment issue

  // OPTION A: If you were using envPrefix, remove or comment it out:
  // envPrefix: 'REACT_APP_',

  // IMPORTANT: Use 'define' to explicitly inject process.env variables
  define: {
    // Ensure the values are stringified, as they are injected directly into the JS code
    'process.env.REACT_APP_FIREBASE_API_KEY': JSON.stringify(process.env.REACT_APP_FIREBASE_API_KEY),
    'process.env.REACT_APP_FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.REACT_APP_FIREBASE_AUTH_DOMAIN),
    'process.env.REACT_APP_FIREBASE_PROJECT_ID': JSON.stringify(process.env.REACT_APP_FIREBASE_PROJECT_ID),
    'process.env.REACT_APP_FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.REACT_APP_FIREBASE_STORAGE_BUCKET),
    'process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID),
    'process.env.REACT_APP_FIREBASE_APP_ID': JSON.stringify(process.env.REACT_APP_FIREBASE_APP_ID),
    'process.env.REACT_APP_FIREBASE_MEASUREMENT_ID': JSON.stringify(process.env.REACT_APP_FIREBASE_MEASUREMENT_ID),
  },

  optimizeDeps: {
    include: ['moment', 'moment-timezone'], // Keep these for moment/moment-timezone resolution
  },
  build: {
    // Keep or adjust your publish_dir if needed
    // rollupOptions: {
    //   external: ['moment', 'moment-timezone'],
    // }
  }
});