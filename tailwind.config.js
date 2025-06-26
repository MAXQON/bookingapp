// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = { // <--- Note: module.exports for v3 default init
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}