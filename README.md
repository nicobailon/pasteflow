# PasteFlow

A desktop app for efficiently selecting and copying code to share with AI assistants.

![PasteFlow Screenshot](https://github.com/user-attachments/assets/d17bc6b4-4c92-4775-8f25-f99fed7d2385)

## Features

- **File Tree Navigation** - Browse and select files from your codebase
- **Token Counting** - Optimized token estimates for LLM context limits
- **Smart Exclusions** - Automatically excludes binary files, build artifacts, and common non-source files
- **Line Range Selection** - Select specific line ranges within files
- **System Prompts** - Create and manage reusable prompts to include with your code
- **Workspace Management** - Save and restore complete application state
- **Dark Mode** - Light and dark theme support

## Installation

Download the latest release from the [Releases](https://github.com/yourusername/pasteflow/releases) page.

Or build from source:

```bash
git clone https://github.com/yourusername/pasteflow.git
cd pasteflow
npm install
npm run build-electron
npm run package
```

## Development

```bash
# Install dependencies
npm install

# Run in development
npm run dev          # Start Vite dev server
npm run dev:electron # Start Electron (in separate terminal)

# Run tests
npm test
npm run test:watch

# Build for production
npm run build-electron
npm run package
```

## Tech Stack

- **Electron** - Desktop application framework
- **React 18** - UI library with TypeScript
- **Vite** - Build tool and dev server
- **tiktoken** - Token counting for LLMs
- **better-sqlite3** - Local database for workspace persistence
- **Jest** - Testing framework

## License

MIT
