const common = {
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  moduleNameMapper: {
    '^@constants$': '<rootDir>/src/constants/index.ts',
    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@file-ops/(.*)$': '<rootDir>/src/file-ops/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',
    'electron': '<rootDir>/src/__tests__/__mocks__/electron.ts',

    '\\.(css|scss)$': '<rootDir>/src/__tests__/__mocks__/styleMock.ts',
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__mocks__/file-mock.ts',
    'lucide-react': '<rootDir>/src/__tests__/__mocks__/lucide-react.ts',
    'react-syntax-highlighter/dist/esm/styles/prism': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    'react-syntax-highlighter': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    '@ai-sdk/react': '<rootDir>/src/__tests__/__mocks__/ai-sdk-react.ts',
    '^.*/worker-factories$': '<rootDir>/src/__tests__/__mocks__/worker-factories.ts',
    '^.*/workers/token-counter-worker\\.ts$': '<rootDir>/src/__tests__/__mocks__/token-counter-worker.ts',
    '^.*/workers/pools/tree-builder-worker-pool$': '<rootDir>/src/__tests__/__mocks__/tree-builder-worker-pool.ts',
  },
  globals: {
    URL: URL,
    'process.env.NODE_ENV': 'test',
  },
  setupFilesAfterEnv: ['<rootDir>/worker-mock-setup.js', '<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$))'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};

module.exports = {
  projects: [
    // Renderer (CJS) project
    {
      displayName: 'renderer',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      ...common,
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          {
            tsconfig: 'tsconfig.jest.json',
            diagnostics: { warnOnly: true }
          }
        ],
      },
      // Avoid picking up main tests in the renderer project
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/dist/',
        '<rootDir>/src/main/',
        '<rootDir>/src/__tests__/setup/',
        '<rootDir>/src/__tests__/test-utils/',
        '<rootDir>/src/__tests__/test-helpers/',
        '<rootDir>/src/__tests__/helpers/',
        '<rootDir>/src/__tests__/__mocks__/'
      ],
      // Coverage is managed at the root level
    },

    // Main (ESM) project – fixes import.meta coverage issues
    {
      displayName: 'main',
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'node',
      ...common,
      // Treat TS as ESM so ts-jest doesn't force CJS and break import.meta
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      globals: {
        ...common.globals,
        'ts-jest': {
          tsconfig: 'tsconfig.jest.main.json',
          useESM: true,
          diagnostics: { warnOnly: true },
        },
      },
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          {
            tsconfig: 'tsconfig.jest.main.json',
            useESM: true,
            diagnostics: { warnOnly: true }
          }
        ],
      },
      testMatch: ['<rootDir>/src/main/**/__tests__/**/*.(test|spec).ts'],
      collectCoverageFrom: [
        'src/main/api-server.ts',
        'src/main/auth-manager.ts',
        'src/main/error-normalizer.ts',
        'src/main/workspace-context.ts',
        'src/security/**/*.ts',
        'src/utils/ignore-utils.ts',
        '!src/**/*.d.ts'
      ],
    }
  ]
  ,
  // Global options (apply to all projects)
  testTimeout: 30000,
  detectOpenHandles: true,
  forceExit: true,
  bail: false,
  verbose: true,
  collectCoverage: true,
  coverageProvider: 'v8',
};
 
