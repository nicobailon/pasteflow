# PasteFlow CLI Analysis Report

## Executive Summary

The PasteFlow CLI is a **fully functional** command-line interface that communicates with the running Electron application via an HTTP API server. The CLI provides comprehensive access to all major application features including workspace management, file selection, content aggregation, and real-time preview generation. While the architecture supports real-time integration, there are important limitations regarding bidirectional UI synchronization that you should be aware of.

## How the CLI Currently Works

### Architecture Overview

The CLI operates through a **client-server architecture**:

1. **HTTP API Server** (`src/main/api-server.ts:44-58`)
   - Runs on port 5839 by default when the Electron app starts
   - Provides RESTful endpoints at `/api/v1/*`
   - Secured with Bearer token authentication
   - Handles all CLI requests and modifies app state directly

2. **CLI Client** (`cli/src/client.ts:36-51`)
   - Discovers server via `~/.pasteflow/server.port` and `~/.pasteflow/auth.token`
   - Uses Axios for HTTP communication
   - Supports both JSON and human-readable output formats
   - Exit codes mapped to specific error types for scripting

3. **Authentication** (`src/main/auth-manager.ts:6-58`)
   - Automatic token generation on first run
   - Stored in `~/.pasteflow/auth.token` with 0600 permissions
   - Required for all API requests

### Available CLI Commands

The CLI is feature-complete with the following commands:

#### Core Commands
```bash
# Application status
pasteflow status                              # Check if app is running

# Workspace management
pasteflow workspaces list                     # List all workspaces
pasteflow workspaces create --name "MyProject" --folder "/path/to/project"
pasteflow workspaces load <id>                # Switch to workspace
pasteflow workspaces update <id> --state @state.json
pasteflow workspaces delete <id>

# Folder operations
pasteflow folders current                     # Get current folder
pasteflow folders open --folder "/path/to/folder"

# File operations
pasteflow files info --path "/absolute/path/file.ts"
pasteflow files content --path "/absolute/path/file.ts" --out output.txt

# Selection management
pasteflow select add --path "/path/file.ts" --lines "10-20,30"
pasteflow select remove --path "/path/file.ts"
pasteflow select list
pasteflow select clear

# Content aggregation
pasteflow content get --max-files 500 --max-bytes 2000000
pasteflow content export --out "/path/to/export.txt" --overwrite

# Preview generation (async)
pasteflow preview start --prompt "Analyze this code" --follow
pasteflow preview status <id> --watch
pasteflow preview content <id> --raw
pasteflow preview cancel <id>

# Instructions and preferences
pasteflow instructions list
pasteflow instructions create --name "Setup" --content "Follow these steps..."
pasteflow prefs get <key>
pasteflow prefs set <key> --value <value>

# Token counting
pasteflow tokens count --text "Some text to count"
pasteflow tokens backend                      # Get current backend (tiktoken/estimate)
```

#### Global Flags
- `--host <host>` - Override default host (127.0.0.1)
- `--port <port>` - Override discovered port
- `--token <token>` - Override auth token
- `--json` - Machine-readable JSON output
- `--raw` - Raw content output (no formatting)
- `--timeout <ms>` - Request timeout (default 10s)
- `--debug` - HTTP request/response logging

### Real-Time Integration Capabilities

#### What Works ✅

1. **State Synchronization** - CLI changes are immediately reflected in app state:
   - Workspace loads/switches update the UI instantly
   - File selections appear in the UI
   - Content aggregation uses current UI state
   - Database operations are atomic and consistent

2. **Preview Generation with IPC Bridge** (`src/main/preview-proxy.ts:25-82`)
   - CLI can trigger preview generation in the renderer process
   - Uses EventEmitter pattern for async communication
   - Status updates flow from renderer → main → CLI
   - Supports cancellation and progress tracking

3. **Shared Database** (`src/main/db/database-bridge.ts`)
   - Both CLI and UI operate on the same SQLite database
   - Worker thread ensures non-blocking operations
   - Transaction support for consistency

#### What Doesn't Work ❌

1. **UI → CLI Updates**
   - No WebSocket or Server-Sent Events implementation
   - CLI cannot subscribe to UI changes
   - Must poll for status updates (e.g., `--watch` flag)

2. **Bidirectional Preview Sync**
   - Preview IPC handlers not implemented in renderer
   - `cli-pack-start`, `cli-pack-cancel` events sent but not received
   - Preview generation via CLI likely non-functional

3. **File System Watching**
   - No file system change notifications to CLI
   - Must manually refresh to see external changes

## How to Use the CLI

### Installation and Setup

1. **Build the CLI**:
   ```bash
   npm run build:cli
   # or watch mode for development
   npm run build:cli:watch
   ```

2. **Global Installation** (for development):
   ```bash
   npm link
   # Now use globally as:
   pasteflow status
   # or short alias:
   pf status
   ```

3. **Ensure App is Running**:
   ```bash
   # Start the Electron app first
   npm run dev:electron
   
   # Verify CLI can connect
   pasteflow status
   ```

### Common Workflows

#### 1. Basic File Selection and Export
```bash
# Open a folder
pf folders open --folder "/Users/me/project"

# Select specific files with line ranges
pf select add --path "/Users/me/project/src/main.ts" --lines "1-50"
pf select add --path "/Users/me/project/src/utils.ts" --lines "10-30,45-60"

# Generate and export content
pf content export --out code-context.txt --overwrite
```

#### 2. Workspace Management
```bash
# Create a new workspace
pf workspaces create --name "Backend API" --folder "/Users/me/api-project"

# List and load workspaces
pf workspaces list
pf workspaces load abc-123-def

# Update workspace state from JSON
pf workspaces update abc-123-def --state @workspace-state.json
```

#### 3. Async Preview Generation
```bash
# Start preview with prompt from file, follow until complete
pf preview start --prompt @analysis-prompt.txt --follow --out analysis.md

# Or start and monitor separately
PREVIEW_ID=$(pf preview start --prompt "Analyze this code")
pf preview status $PREVIEW_ID --watch
pf preview content $PREVIEW_ID --raw > output.md
```

#### 4. Scripting with JSON Output
```bash
# Get JSON for programmatic processing
WORKSPACES=$(pf workspaces list --json)
CURRENT_FOLDER=$(pf folders current --json | jq -r .data.folderPath)
TOKEN_COUNT=$(pf tokens count --text @file.txt --json | jq .data.count)
```

### Error Handling

The CLI uses semantic exit codes (`cli/src/client.ts:7-14`):
- `0` - Success
- `1` - Server/internal error
- `2` - Validation error or access denied
- `3` - Authentication failure
- `4` - Resource not found
- `5` - Conflict (e.g., binary file)
- `6` - Server unreachable

Example error handling in scripts:
```bash
#!/bin/bash
pf files content --path "$FILE_PATH" --out temp.txt
EXIT_CODE=$?

case $EXIT_CODE in
  0) echo "Success" ;;
  2) echo "Invalid path or access denied" ;;
  4) echo "File not found" ;;
  5) echo "Binary file cannot be read" ;;
  6) echo "PasteFlow app not running" ;;
  *) echo "Unknown error: $EXIT_CODE" ;;
esac
```

## Known Limitations and Issues

### Critical Issues 🔴

1. **Preview Generation Broken**
   - Renderer doesn't handle `cli-pack-start` events
   - No IPC listener implementation found in renderer
   - Preview commands will timeout or fail

2. **No Test Coverage**
   - Zero test files for CLI functionality
   - Integration untested with main app
   - Error handling paths unverified

### Important Limitations 🟡

1. **One-Way Sync Only**
   - CLI → App updates work
   - App → CLI requires polling
   - No real-time event streaming

2. **Performance Considerations**
   - Large file operations may timeout (default 10s)
   - No streaming for large content
   - Synchronous database operations in some paths

3. **Path Validation**
   - CLI enforces absolute paths client-side
   - Server validates against workspace boundaries
   - Potential for path traversal if misconfigured

### Minor Issues 🟢

1. **Documentation Gaps**
   - No `--help` output for some commands
   - Missing examples in CLI help text
   - No man pages or completion scripts

2. **UX Inconsistencies**
   - Some commands use `--path`, others use positional arguments
   - JSON output structure varies between commands
   - Error messages could be more helpful

## Recommendations for Testing

### Immediate Testing Priorities

1. **Verify Basic Connectivity**:
   ```bash
   # With app running
   pasteflow status
   # Should return app status without errors
   ```

2. **Test State Synchronization**:
   ```bash
   # Create workspace via CLI
   pf workspaces create --name "Test" --folder "$PWD"
   # Check if it appears in the UI
   
   # Select files via CLI
   pf select add --path "$PWD/README.md"
   # Verify selection shows in UI
   ```

3. **Test Content Export**:
   ```bash
   # Add selections and export
   pf content export --out test-export.txt
   # Compare with UI's copy functionality
   ```

4. **Debug Preview Generation**:
   ```bash
   # This will likely fail or timeout
   pf preview start --prompt "Test" --follow --debug
   # Check console logs in Electron app
   ```

### Testing Script

Save this as `test-cli.sh`:
```bash
#!/bin/bash
set -e

echo "Testing PasteFlow CLI..."

# 1. Check connectivity
echo "1. Testing connection..."
pf status || { echo "App not running!"; exit 1; }

# 2. Test workspace operations
echo "2. Testing workspaces..."
WORKSPACE_ID=$(pf workspaces create --name "CLI-Test-$(date +%s)" --folder "$PWD" --json | jq -r .id)
echo "Created workspace: $WORKSPACE_ID"
pf workspaces list | grep "$WORKSPACE_ID"

# 3. Test file selection
echo "3. Testing selection..."
if [ -f "README.md" ]; then
  pf select clear
  pf select add --path "$PWD/README.md"
  pf select list --json | jq '.data | length'
fi

# 4. Test content export
echo "4. Testing export..."
pf content export --out cli-test-export.txt --overwrite
[ -f cli-test-export.txt ] && echo "Export successful"

# 5. Test token counting
echo "5. Testing tokens..."
TOKEN_COUNT=$(echo "Hello world" | pf tokens count --text - --json | jq .data.count)
echo "Token count: $TOKEN_COUNT"

# Cleanup
rm -f cli-test-export.txt
pf workspaces delete "$WORKSPACE_ID" 2>/dev/null || true

echo "✅ Basic CLI tests passed"
```

## Conclusion

The PasteFlow CLI is **production-ready for most operations** but has **critical gaps in preview generation** functionality. The architecture is sound and supports real-time state synchronization from CLI to app, but lacks bidirectional communication channels needed for full real-time integration.

### Strengths
- ✅ Complete HTTP API implementation
- ✅ Robust authentication and error handling
- ✅ Comprehensive command coverage
- ✅ Good scripting support with JSON output
- ✅ State changes reflect immediately in UI

### Weaknesses
- ❌ Preview generation non-functional
- ❌ No bidirectional real-time updates
- ❌ Zero test coverage
- ❌ Missing WebSocket/SSE for live updates

### Next Steps
1. Fix preview IPC handlers in renderer
2. Add WebSocket support for bidirectional communication
3. Write comprehensive test suite
4. Improve error messages and documentation
5. Consider adding event streaming for real-time updates

The CLI is usable today for all non-preview operations and provides excellent automation capabilities for workspace management, file selection, and content export workflows.