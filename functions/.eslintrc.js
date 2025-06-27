// C:\dj-booking-app\functions\.eslintrc.js

module.exports = {
  root: true,
  env: {
    es6: true,
    node: true, // This tells ESLint it's a Node.js environment
  },
  extends: [
    "eslint:recommended",
    "google", // Keep the Google style guide
  ],
  parserOptions: {
    ecmaVersion: 2018, // Can be set higher if your Node.js version supports it (e.g., 2020, 2022)
    sourceType: "script", // Explicitly define as CommonJS script, not 'module' (ESM)
  },
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    // Allow console.log for Cloud Functions debugging
    "no-console": "off",
  },
  globals: {
    // Explicitly define CommonJS globals as available
    module: true,
    require: true,
    exports: true,
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
};