module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    // Handle CSS imports (with CSS modules)
    '\\.(css|scss)$': '<rootDir>/src/__tests__/__mocks__/styleMock.js',
    // Handle image imports
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__mocks__/fileMock.js',
    // Use shared lucide-react mock
    'lucide-react': '<rootDir>/src/__tests__/__mocks__/lucide-react.js',
    // Mock react-syntax-highlighter
    'react-syntax-highlighter/dist/esm/styles/prism': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.js',
    'react-syntax-highlighter': '<rootDir>/src/__tests__/__mocks__/react-syntax-highlighter.js',
  },
  globals: {
    URL: URL,
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist/'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
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
}; 