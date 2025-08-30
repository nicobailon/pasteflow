module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  moduleNameMapper: {
    '^@constants$': '<rootDir>/src/constants/index.ts',
    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@file-ops/(.*)$': '<rootDir>/src/file-ops/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',

    // Handle CSS imports (with CSS modules)
    '\\.(css|scss)$': '<rootDir>/src/__tests__/__mocks__/styleMock.ts',
    // Handle image imports
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__mocks__/file-mock.ts',
    // Use shared lucide-react mock
    'lucide-react': '<rootDir>/src/__tests__/__mocks__/lucide-react.ts',
    // Mock react-syntax-highlighter
    'react-syntax-highlighter/dist/esm/styles/prism': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    'react-syntax-highlighter': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    // Mock worker factories to avoid import.meta.url issues during tests
    '^.*/worker-factories$': '<rootDir>/src/__tests__/__mocks__/worker-factories.ts',
    // Handle worker imports
    '^.*/workers/token-counter-worker\\.ts$': '<rootDir>/src/__tests__/__mocks__/token-counter-worker.ts',
    // NOTE: Do not mock token-worker-pool; tests exercise real pool behavior
    // Mock TreeBuilderWorkerPool to avoid import.meta.url issues during tests
    '^.*/utils/tree-builder-worker-pool$': '<rootDir>/src/__tests__/__mocks__/tree-builder-worker-pool.ts',
  },
  globals: {
    URL: URL,
    'process.env.NODE_ENV': 'test',
  },
  setupFilesAfterEnv: ['<rootDir>/worker-mock-setup.js', '<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/', 
    '<rootDir>/dist/',
    '<rootDir>/src/__tests__/setup/',
    '<rootDir>/src/__tests__/test-utils/',
    '<rootDir>/src/__tests__/test-helpers/',
    '<rootDir>/src/__tests__/helpers/',
    '<rootDir>/src/__tests__/__mocks__/'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      diagnostics: {
        warnOnly: true
      }
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverage: true,
  collectCoverageFrom: [
    // Focus coverage on Day 2–3 HTTP API and security modules to avoid unrelated TS compile errors
    'src/main/api-server.ts',
    'src/main/auth-manager.ts',
    'src/main/error-normalizer.ts',
    'src/main/workspace-context.ts',
    'src/security/**/*.ts',
    'src/utils/ignore-utils.ts',
    // Always exclude declarations
    '!src/**/*.d.ts'
  ],
  // Performance and debugging configurations
  testTimeout: 30000, // Increase global timeout to 30 seconds
  maxWorkers: 2, // Limit parallel test execution
  detectOpenHandles: true, // Help identify hanging tests
  forceExit: true, // Force Jest to exit after tests complete
  bail: false, // Continue running tests after first failure
  verbose: true, // More detailed output
}; 
