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

    // Handle CSS imports (with CSS modules)
    '\\.(css|scss)$': '<rootDir>/src/__tests__/__mocks__/styleMock.ts',
    // Handle image imports
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__mocks__/fileMock.ts',
    // Use shared lucide-react mock
    'lucide-react': '<rootDir>/src/__tests__/__mocks__/lucide-react.ts',
    // Mock react-syntax-highlighter
    'react-syntax-highlighter/dist/esm/styles/prism': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    'react-syntax-highlighter': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.ts',
    // Handle worker imports
    '^.*/workers/token-counter-worker\\.ts$': '<rootDir>/src/__tests__/__mocks__/token-counter-worker.ts',
    // Mock TokenWorkerPool to avoid import.meta.url issues
    '^.*/utils/token-worker-pool$': '<rootDir>/src/__tests__/__mocks__/token-worker-pool.ts',
  },
  globals: {
    URL: URL,
    'process.env.NODE_ENV': 'test',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/', 
    '<rootDir>/dist/',
    '<rootDir>/src/__tests__/setup/',
    '<rootDir>/src/__tests__/test-utils/',
    '<rootDir>/src/__tests__/test-helpers/',
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
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
    '!src/declarations.d.ts',
  ],
  // Performance and debugging configurations
  testTimeout: 30000, // Increase global timeout to 30 seconds
  maxWorkers: 2, // Limit parallel test execution
  detectOpenHandles: true, // Help identify hanging tests
  forceExit: true, // Force Jest to exit after tests complete
  bail: false, // Continue running tests after first failure
  verbose: true, // More detailed output
}; 