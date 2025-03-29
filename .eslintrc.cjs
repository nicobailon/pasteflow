module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh", "filenames"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "@typescript-eslint/no-explicit-any": "off", // During development, allow 'any' type
    "@typescript-eslint/no-unused-vars": "warn",
    "filenames/match-regex": ["warn", "^[a-z0-9-]+(.d)?$", true],
    "filenames/match-exported": ["warn", "kebab"],
    "filenames/no-index": "off",
    "react-hooks/rules-of-hooks": "warn", // Downgrade to warning for now
  },
  settings: {
    react: {
      version: "detect",
    },
  },
};
