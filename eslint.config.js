import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/",
      ".data/",
      ".deploy/",
      ".tools/",
      "phantom-router/",
      "..sylion_secure_router_im/",
      "docs/",
      "infrastructure/",
      "package-lock.json"
    ]
  },
  js.configs.recommended,
  {
    files: ["services/**/*.js", "scripts/**/*.{js,mjs}", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  },
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  },
  {
    // Skrypty Playwright: callbacki page.evaluate() wykonuja sie w przegladarce.
    files: [
      "scripts/admin-dashboard-smoke.mjs",
      "scripts/admin-step3-28-human-live-promotion.mjs",
      "scripts/operator-portal-smoke.mjs"
    ],
    languageOptions: {
      globals: { ...globals.node, document: "readonly", window: "readonly" }
    }
  },
  {
    files: ["apps/admin-web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  },
  {
    files: ["apps/operator-web/**/*.js", "apps/customer-portal/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  }
];
