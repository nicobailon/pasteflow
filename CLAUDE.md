# PasteMax Build/Dev Commands

- `npm run dev` - Run Vite development server
- `npm run dev:electron` - Run Electron development mode
- `npm run build` - Build frontend with Vite
- `npm run build-electron` - Build Electron app
- `npm run lint` - Run ESLint checks
- `npm run lint:strict` - Run ESLint with zero warnings allowed
- `npm run package` - Build and package app for current platform
- `npm run package:mac|win|linux` - Build for specific platform
- `npm run verify-build` - Check build configuration

# Code Style Guidelines

- **TypeScript**: Use strong typing with interfaces in `src/types/`
- **React Components**: Use functional components with hooks
- **File Structure**: Put components in `src/components/` with PascalCase names
- **Imports**: Group imports (React, local components, contexts, utils)
- **Error Handling**: Use optional chaining and handle potential nulls
- **Formatting**: Use 2-space indentation, semicolons, and single quotes
- **Naming**: Use PascalCase for components, camelCase for variables and functions
- **Utils**: Create utility functions in appropriate files under `src/utils/`