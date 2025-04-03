# PasteFlow Build/Dev Commands

- `npm run dev` - Run Vite development server
- `npm run dev:electron` - Run Electron development mode
- `npm run build` - Build frontend with Vite
- `npm run build-electron` - Build Electron app
- `npm run lint` - Run ESLint checks
- `npm run lint:strict` - Run ESLint with zero warnings allowed
- `npm run test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm test -- -t "test name"` - Run single test by name
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:debug` - Run tests with Node debugger attached
- `npm run package` - Build and package app for current platform
- `npm run package:mac|win|linux` - Build for specific platform

## Project Structure

- `/src` - Source code
  - `/components` - React components
  - `/hooks` - Custom React hooks
  - `/utils` - Utility functions and helpers
    - `/path-utils.ts` - Path handling utilities
    - `/token-utils.ts` - Token estimation utilities
    - `/xml-templates.ts` - XML formatting templates
    - `/xml-templates-react.ts` - React-specific XML templates
    - `/file-processing.ts` - File processing and binary detection utilities
    - `/file-utils.ts` - File manipulation utilities
    - `/ignore-utils.ts` - GitIgnore pattern handling utilities
    - `/ui-utils.ts` - UI state management utilities
    - `/content-formatter.ts` - Content formatting utilities
    - `/xml-parser.ts` - XML parsing utilities
    - `/workspace-utils.ts` - Workspace management utilities
  - `/styles` - CSS styles
  - `/types` - TypeScript type definitions
  - `/constants` - Application constants
  - `/context` - React context providers
  - `/handlers` - Event handlers
  - `/main` - Main application code
  - `/assets` - Static assets
  - `/examples` - Example code
  - `/docs` - Documentation files
  - `/__tests__` - Test files
  - `/index.tsx` - Application entry point
  - `/main.tsx` - Main renderer
  - `/constants.ts` - Global constants
  - `/declarations.d.ts` - TypeScript declarations
  - `/index.html` - HTML entry point
  - `/react-app-env.d.ts` - React environment declarations
- `/public` - Static assets
- `/electron` - Electron-specific code
- `/dist` - Build output directory

## Code Style Guidelines

- **TypeScript**: Use strong typing with interfaces in `src/types/`
  - Define comprehensive interfaces for component props and state
  - Avoid using `any` type; prefer `unknown` when type is uncertain
  - Use union types, generics, and type guards appropriately

- **React Components**:
  - Use functional components with hooks
  - Implement proper cleanup in useEffect hooks
  - Memoize expensive calculations with useMemo
  - Memoize callbacks with useCallback when passed as props

- **File Structure**:
  - Put components in `src/components/` with PascalCase names
  - Group related components in subdirectories
  - Keep component files focused on a single responsibility
  - Consider extracting complex logic to custom hooks

- **Imports**:
  - Group imports in the following order:
    1. React and React-related libraries
    2. Third-party libraries
    3. Local components
    4. Types
    5. Utilities and hooks
    6. Assets (styles, images)

- **Testing**:
  - Use Jest with React Testing Library
  - Mock external APIs and services
  - Test component behavior, not implementation details
  - Write integration tests for critical user flows
  - Use data-testid attributes for test selectors

- **Error Handling**:
  - Use optional chaining and nullish coalescing for safer access
  - Implement proper error boundaries for component failures
  - Use try/catch with async/await for async operations
  - Provide meaningful error messages and fallback UIs

- **Formatting**:
  - 2-space indentation
  - Semicolons required
  - Single quotes for strings
  - Trailing commas in multiline objects/arrays
  - Maximum line length of 100 characters

- **Naming**:
  - PascalCase for components and interfaces
  - camelCase for variables, functions, and methods
  - UPPER_SNAKE_CASE for constants
  - Use descriptive, intention-revealing names

- **Utils**:
  - Create utility functions in appropriate files under `src/utils/`
  - Keep utility functions pure when possible
  - Implement proper type signatures for all utilities
  - Test utilities thoroughly

- **Path Handling**:
  - Use dedicated path utilities from `src/utils/pathUtils.ts`
  - Normalize paths consistently using `normalizePath` function
  - Calculate relative paths with `getRelativePath` utility
  - Extract file extensions with `extname` function
  - Get file/directory names with `basename` utility

- **Sidebar Loading**:
  - Implement consolidated loading state management
  - Use minimum display times to prevent flickering
  - Show appropriate loading indicators during async operations
  - Handle component cleanup properly to prevent memory leaks

- **Token Estimation**:
  - Use `estimateTokenCount` utility for accurate token counting
  - Calculate tokens for different file tree modes
  - Track token counts for user instructions
  - Optimize content to fit within model context limits
  - Only calculate tokens for loaded files to improve performance

- **Lazy Content Loading**:
  - Use the `loadFileContent` utility to load file content on-demand
  - Show loading indicators while file content is being loaded
  - Implement cancellation for loading operations
  - Process directories in batches to prevent UI freezing
  - Add isContentLoaded flag to FileData objects to track loading state

- **Binary File Detection**:
  - Use `isBinaryContent` utility to detect binary files
  - Skip token counting for binary files
  - Prevent loading of binary content that could crash the application
  - Use file extensions and content analysis for detection

- **File Exclusion**:
  - Use gitignore patterns to filter out common excluded files
  - Check `excluded-files.ts` for default exclusion patterns
  - Support custom exclusion patterns via UI
  - Filter system files, build artifacts, and other non-relevant files
  - Exclude binary files by default (images, executables, etc.)

- **Application Reset**:
  - Use `resetAppState` utility to clear current workspace
  - Reset selected folder, files, and application state
  - Clear session flag to show welcome screen on next startup
  - Provide UI option to create new workspaces

- **Documentation**:
  - Add JSDoc comments for functions and components
  - Document props with descriptive comments
  - Maintain up-to-date README and documentation files
  - Include examples for complex functionality
