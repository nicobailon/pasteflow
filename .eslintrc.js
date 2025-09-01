process.env.TSESTREE_NO_WARN_ON_MULTIPLE_PROJECTS = "true";
module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:react/recommended",
    "plugin:sonarjs/recommended",
    "plugin:unicorn/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:jsx-a11y/recommended"
  ],
  ignorePatterns: ["dist", ".eslintrc.js", "*.json"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    noWarnOnMultipleProjects: true
  },
  plugins: [
    "react-refresh",
    "filenames",
    "json",
    "react",
    "sonarjs",
    "unicorn",
    "import",
    "jsx-a11y"
  ],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_"
    }],
    "@typescript-eslint/array-type": ["error", { default: "array" }],
    "@typescript-eslint/no-inferrable-types": "warn",
    "filenames/match-regex": ["warn", "^[a-z0-9-]+(\\.[a-z0-9-]+)*(.d)?$", true],
    "filenames/match-exported": ["warn", "kebab"],
    "filenames/no-index": "off",
    "react-hooks/rules-of-hooks": "warn",
    "no-control-regex": "warn",
    "sonarjs/no-identical-expressions": "error",
    "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
    "sonarjs/cognitive-complexity": ["warn", 30],
    "sonarjs/no-duplicated-branches": "warn",
    "unicorn/prevent-abbreviations": "off",
    "unicorn/no-null": "off",
    "unicorn/filename-case": "off",
    "unicorn/expiring-todo-comments": "off",
    "unicorn/consistent-function-scoping": "warn",
    "unicorn/no-array-callback-reference": "warn",
    "unicorn/consistent-destructuring": "warn",
    "unicorn/no-array-reduce": "warn",
    "unicorn/no-array-for-each": "warn",
    "unicorn/prefer-string-slice": "warn",
    "unicorn/prefer-module": "warn",
    "unicorn/no-process-exit": "warn",
    "unicorn/no-new-array": "warn",
    "unicorn/prefer-add-event-listener": "warn",
    "import/order": ["warn", { groups: ["builtin", "external", "internal", "parent", "sibling", "index"], newlinesBetween: "always" }],
    "import/no-unresolved": "warn",
    "import/no-named-as-default-member": "warn",
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    "jsx-a11y/no-noninteractive-element-interactions": "error",
    "jsx-a11y/no-noninteractive-tabindex": "error",
    "jsx-a11y/no-redundant-roles": "warn"
  },
  overrides: [
    {
      // Scripts and root JS files
      files: ["scripts/*.js", "*.js", "preload.js", "renderer.js", "dev.js"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
        "no-useless-escape": "warn"
      }
    },
    {
      // Dev and TS scripts are CLI-like; allow process.exit
      files: ["dev.ts", "build.ts", "scripts/**/*.ts"],
      rules: {
        "unicorn/no-process-exit": "off",
        "unicorn/prefer-module": "off"
      }
    },
    {
      // Scripts folder
      files: ["scripts/*.js"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off"
      }
    },
    {
      files: ["src/hooks/*"],
      rules: {
        complexity: ["warn", { max: 25 }],
        "@typescript-eslint/no-unused-vars": "warn"
      }
    },
    {
      // CLI project resolver
      files: ["cli/src/**/*.ts"],
      parserOptions: {
        project: "./cli/tsconfig.json",
        tsconfigRootDir: __dirname,
        noWarnOnMultipleProjects: true
      },
      rules: { "unicorn/no-process-exit": "off" }
    }
  ],
  settings: {
    react: { version: "detect" },
    "import/resolver": {
      typescript: {
        project: [
          "./tsconfig.base.json",
          "./tsconfig.json",
          "./tsconfig.scripts.json",
          "./cli/tsconfig.json"
        ],
        alwaysTryTypes: true
      }
    }
  }
};
