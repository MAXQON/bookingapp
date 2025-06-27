// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '',
  // No explicit 'css' block needed here for PostCSS/Tailwind,
  // Vite will automatically discover postcss.config.js
})