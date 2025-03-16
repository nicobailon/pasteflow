# PasteFlow

PasteFlow is a streamlined productivity tool designed for developers working with AI coding assistants. It allows developers to manage context precisely by packaging their code and instructions in an optimized format for AI interaction.

The app creates a seamless bridge between your codebase and external AI platforms like ChatGPT and Claude. Code changes suggested by AI are captured as XML diffs that can be automatically applied back to your original files with a single action.

Originally forked from PasteFlow, this enhanced version eliminates friction in the development workflow by maintaining perfect context throughout the entire process—from sending code to AI assistants to implementing their suggested changes.

![PasteFlow Screenshot](https://github.com/user-attachments/assets/d17bc6b4-4c92-4775-8f25-f99fed7d2385)

## Features

- **File Tree Navigation**: Browse directories and files with an expandable tree view
- **Token Counting**: View the approximate token count for each file (useful for LLM context limits)
- **Search Capabilities**: Quickly find files by name or content
- **Selection Management**: Select multiple files and copy their contents together
- **Advanced Sorting Options**: Sort files by name, size, token count, extension, or date with the following capabilities:
  - Priority-based sorting for directories and files
  - Natural sorting for filenames
  - Option to sort directories first
  - Multiple sorting criteria in a single view
- **File Tree Refresh**: Quickly refresh the file tree to reflect changes made outside the app, perfect for when you:
  - Make changes to files using external editors
  - Add or delete files through other applications
  - Pull updates from version control systems
  - Need to ensure you're seeing the most current state of your project
- **Custom File Exclusion Patterns**: Define custom patterns for excluding files from the tree view
- **Dark Mode**: Toggle between light and dark themes for comfortable viewing in any environment
- **Binary File Detection**: Automatic detection and exclusion of binary files
- **Smart File Exclusion**: Automatically excludes common files like package-lock.json, binary files, and more by default
- **File Tree Structure Options**: Choose how to include file structure in your copies:
  - None: Just the file contents
  - Selected: Include only the selected files in the tree
  - Selected with Roots: Include selected files with their parent directories
  - Complete: Include the entire directory structure
- **Apply XML Changes**: Apply code changes to your project directly from XML formatted instructions
- **Copy with XML Prompt**: Copy selected files with XML formatting instructions for LLMs to generate structured changes
- **One-Click Copy**: Easily copy file contents with a dedicated copy button for each file
  - Works across all browsers and environments with a robust fallback mechanism
  - Provides visual feedback when content is copied
  - Fully accessible with keyboard support
- **Cross-Platform Path Handling**: Consistent normalization and relative path calculations across browser and Node.js environments
  - Platform-independent path utilities for working with file paths
  - Reliable path operations regardless of operating system
  - Smart handling of path separators for Windows and Unix-like systems
- **Enhanced Sidebar Loading State**: Improved user experience with consolidated loading indicators
  - Smooth loading transitions with minimum display times to prevent flickering
  - Visual feedback during file tree building and processing operations
  - Concurrent handling of multiple loading states
- **Token Estimation for Prompts**: Detailed token counting for all content components
  - Real-time token estimation for user instructions
  - Dynamic token counts for different file tree modes
  - Accurate representation of context consumption for AI models

## Features in Latest Updates

- **Enhanced Clipboard Compatibility**: Added fallback mechanism to ensure the copy functionality works across all environments, including those without navigator.clipboard support
- **Advanced Pattern Validation**: Improved validation in the FilterModal for complex exclusion patterns to prevent performance issues
- **Optimized Cache Management**: Enhanced cache invalidation in the file tree management to ensure consistent performance during sorting operations
- **Code Optimization**: Replaced console logging with proper null operations for cleaner code execution
- **Dependency Classification**: Properly categorized dependencies for development versus runtime to optimize bundle size
- **Path Utilities Refactoring**: Introduced new path utilities for consistent path normalization and relative path calculations
- **Sidebar Loading Enhancement**: Consolidated processing status and tree building completion states for smoother user experience
- **Token Estimation Improvements**: Added comprehensive token estimation for user instructions and different file tree modes

## Installation

### Download Binary

Download the latest version from our official distribution channel.

### Or Build from Source

1. Clone the repository:

```
git clone [repository URL]
cd pasteflow
```

2. Install dependencies:

```
npm install
```

3. Build the app:

```
npm run build-electron
npm run dist
```

## Development

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Setup

1. Clone the repository
2. Install dependencies:

```
npm install
```

### Running in Development Mode

To run the application in development mode:

```
# Start the Vite dev server
npm run dev

# In a separate terminal, start Electron
npm run dev:electron
```

### Running Tests

PasteFlow includes a suite of unit tests to ensure functionality works as expected:

```
# Run tests once
npm test

# Run tests in watch mode during development
npm run test:watch
```

### Building for Production

To build the application for production:

```
# Build the React app with Vite and update paths for Electron
npm run build-electron

# Create platform-specific distributables
npm run dist
```

### Code Signing

The release workflow includes automatic code signing for both macOS and Windows when building from the main repository (not forks):

- **macOS**: Utilizes Apple Developer certificates for notarization and signing
- **Windows**: Uses code signing certificates provided through environment variables

Code signing ensures users can install and run the application without security warnings on modern operating systems.

## Project Structure

- `src/` - React application source code
  - `components/` - React components
    - `CopyButton/` - Component for copying content to clipboard
    - `FilterModal/` - Component for managing file exclusion patterns
    - `FileTreeToggle/` - Component for file tree structure options
  - `types/` - TypeScript type definitions
  - `styles/` - CSS styles
  - `utils/` - Utility functions
    - `useFileTree/` - Custom hook for file tree management and sorting
    - `useLocalStorage/` - Enhanced localStorage hook with type safety
    - `pathUtils/` - Utilities for path handling and normalization
  - `__tests__/` - Unit tests
- `main.js` - Electron main process
- `build.js` - Build script for production
- `excluded-files.js` - Configuration for files to exclude by default
- `docs/` - Documentation
  - `excluded-files.md` - Documentation for the file exclusion feature

## XML Changes Feature

The Apply XML Changes feature allows you to apply code changes to your project directly from XML formatted instructions. This is particularly useful when working with LLMs like ChatGPT that can generate structured changes to your codebase.

### XML Format

```xml
<changed_files>
  <file>
    <file_summary>Brief description of what changed</file_summary>
    <file_operation>CREATE|UPDATE|DELETE</file_operation>
    <file_path>relative/path/to/file.ext</file_path>
    <file_code>
      // The complete new content for the file (for CREATE or UPDATE operations)
    </file_code>
  </file>
  <!-- Add more file elements as needed for additional changes -->
</changed_files>
```

### Operations

- **CREATE**: Create a new file
- **UPDATE**: Update an existing file
- **DELETE**: Delete a file

## Libraries Used

- Electron - Desktop application framework
- React - UI library
- TypeScript - Type safety
- Vite - Build tool and development server
- tiktoken - Token counting for LLM context estimation
- ignore - .gitignore-style pattern matching for file exclusions
- Jest - Testing framework (dev)
- @testing-library/react - React testing utilities (dev)
- prettier - Code formatting (dev)
- @xmldom/xmldom - XML parsing for the Apply Changes feature

## Customization

### File Exclusion Patterns

You can customize which files are excluded from the file tree in two ways:

1. **Global Default Settings**: Edit the `excluded-files.js` file to change the default exclusion patterns for all projects.

2. **Project-Specific Settings**: Use the Filter Modal within the app to set exclusion patterns specific to the current project. These patterns are stored locally and will be remembered when you reopen the project.

Exclusion patterns follow the same syntax as `.gitignore` files, making them familiar and powerful for developers.

### Pattern Validation

The FilterModal provides intelligent validation for exclusion patterns to help prevent potential issues:

- **Syntax Validation**: Checks for proper syntax in your patterns
- **Performance Safeguards**: Identifies patterns that might cause excessive resource usage:
  - Patterns with too many consecutive asterisks
  - Patterns with an excessive number of wildcards
  - Complex combinations of alternations and globstars
- **Immediate Feedback**: Provides clear error messages to help troubleshoot pattern issues

## Troubleshooting

### "Cannot find module 'ignore'" error

If you encounter this error when running the packaged application:

```
Error: Cannot find module 'ignore'
Require stack:
- /Applications/PasteFlow.app/Contents/Resources/app.asar/main.js
```

This is caused by dependencies not being properly included in the package. To fix it:

1. Run the dependency fixer script:

   ```
   node fix-dependencies.js
   ```

2. Rebuild the application:

   ```
   npm run build-electron && npm run dist
   ```

3. Install the new version

### Other Issues

For assistance with other issues, please contact our support team.
