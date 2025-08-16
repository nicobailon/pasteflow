# PasteFlow CLI Integration – Analysis and Implementation Plan v2

## Executive Summary

CLI integration is feasible and can align well with PasteFlow’s current architecture. The codebase already exposes a structured set of IPC channels (both legacy and secure-typed variants), event broadcasting utilities, and a SQLite-backed state layer. However, the original analysis document overstates some existing patterns (e.g., generic GUI “state-update” channel, React listeners for it) and mixes recommendations with examples that don’t match actual channels and handlers. This v2 plan corrects those, grounds the approach in existing modules and channels, and proposes a minimally invasive, secure path to a standalone CLI with optional real-time sync.

Key corrections:
- There is a broadcastUpdate helper in main.js, but the actual renderer update channels are specific (e.g., "/prefs/get:update", "/workspace/selection:update"), not a generic "state-update".
- File discovery already streams via "file-list-data" and status via "file-processing-status"; there is no renderer listener for a generic "state-update".
- The secure IPC layer and typed handlers exist under src/main/ipc/secure-ipc.ts and src/main/handlers/state-handlers.ts, compiled at build time to build/main/... used when SECURE_IPC=1.
- Workspace handlers exist and are invoked via window.electron.ipcRenderer.invoke("/workspace/...", ...). Legacy handlers exist in main.js when secure path is disabled.

Recommended approach: Start with a standalone Node.js CLI that talks to PasteFlow via a local transport (Unix domain socket/Windows named pipe or localhost TCP) and bridges into existing IPC handlers in the Electron main process. For real-time sync, leverage specific update channels already broadcast, or add narrowly scoped ones rather than a generic event bus.

## Current Architecture – Verified Inventory

- Electron entry: main.js
  - Legacy handlers present for:
    - request-file-list (ipcMain.on)
    - request-file-content (ipcMain.handle)
    - /workspace/* handlers (list/create/load/update/touch/delete/rename) when secure path is disabled
    - broadcastUpdate(channel, data?) helper at main.js:1254 used by preferences
  - DatabaseBridge (src/main/db/database-bridge.js) for legacy DB with fallback
  - Feature-flagged secure path: SECURE_IPC=1 loads build/main/ipc/secure-ipc.js, build/main/handlers/state-handlers.js, build/main/db/secure-database.js

- Secure path (TypeScript sources):
  - src/main/ipc/secure-ipc.ts
    - Zod schemas loaded from lib/main/ipc/schemas.cjs
    - registerChannel + setHandler pattern; performs origin checks and rate limiting
  - src/main/handlers/state-handlers.ts
    - Registers handlers for:
      - Workspaces: /workspace/list, /workspace/create, /workspace/load, /workspace/update, /workspace/touch, /workspace/delete, /workspace/rename
      - File content: /file/content
      - Prompts: /prompts/system, /prompts/system/add|update|delete; /prompts/role/*; /prompts/active
      - Preferences: /prefs/get, /prefs/set
      - Workspace selection: /workspace/selection, /workspace/selection/update, /workspace/selection/clear
    - Broadcasts updates via BrowserWindow.getAllWindows().webContents.send(channel, data?) with concrete channels (e.g., "/prefs/get:update", "/workspace/selection:update")
  - src/main/db/secure-database.ts (encryption/key management; dedup file content)
  - src/main/db/schema.sql includes workspaces, file_contents, instructions tables, etc.

- Renderer integration:
  - preload.js exposes window.electron with send/on/invoke wrappers
  - File scanning and content loading:
    - window.electron.ipcRenderer.send("request-file-list", folder, patterns, requestId)
    - window.electron.ipcRenderer.on("file-list-data" | "file-processing-status" | "folder-selected", ...)
    - window.electron.ipcRenderer.invoke("request-file-content", filePath) in legacy path
  - Data hooks using secure channels where available:
    - useDatabaseWorkspaceState: window.electron.ipcRenderer.invoke("/workspace/list"), "/workspace/load", "/workspace/touch"
    - useDatabaseState subscribes to `${channel}:update` for broadcasts

## Discrepancies vs Original Analysis

- Generic GUI "state-update" event: Not present. Use specific update channels (e.g., "/prefs/get:update", "/workspace/selection:update") or introduce a dedicated new channel if truly needed.
- React listener example for 'state-update': No such listener exists; renderer relies on concrete channels and the file list/status events.
- Named references:
  - request-file-list and request-file-content exist and are correct (legacy path in main.js)
  - Workspace endpoints are correct but names must be exact (e.g., "/workspace/touch" exists in code, also rename/delete)
  - Database and worker thread references are accurate; main.js uses streaming batches with workers for scanning (pendingFiles/NUM_WORKERS), and separate token/tree workers exist in src/workers

## Feasibility Assessment

- Technical soundness: High. The main process already encapsulates operations needed by a CLI. The secure IPC layer provides validation and rate-limiting. Renderers already consume precise channels and can react to changes broadcast from main.
- Compatibility with conventions: Good. Use the secure IPC where possible; otherwise call legacy channels. Favor typed channels from lib/main/ipc/schemas.cjs.
- Completeness: Missing pieces are an external transport for CLI-to-app communication and a main-process bridge that converts CLI requests into the existing IPC invocations (or direct calls to DB abstractions when appropriate). Also need auth and lifecycle management for the server.
- Scope/complexity: Reasonable if phased. Start with a small command set mapping 1:1 to existing handlers.

## Proposed Architecture (Adjusted)

Approach A (Recommended): Standalone CLI + Main-process Local Server Bridge
- Add a local server in main.js that listens on a Unix socket/Windows pipe or localhost TCP, gated behind a feature flag (e.g., PF_CLI_SERVER=1) and dev-only by default.
- Define a compact JSON-RPC-like protocol:
  - request: { id, method, params }
  - response: { id, result? , error? }
- Server routes methods to existing handlers:
  - File scanning: emit "request-file-list" and stream progress via server-side events; or expose a method that returns final listing after scan completes.
  - File content: call ipcMain.handle("request-file-content") or secure "/file/content" if workspace context is established.
  - Workspaces: bridge to "/workspace/*" secure channels by calling the corresponding handlers directly in-process (prefer direct handler functions or ipc layer; avoid going through renderer).
- Broadcasting to GUI:
  - Reuse broadcastUpdate and/or StateHandlers.broadcastUpdate to send specific update channels that the renderer already listens for (e.g., "/prefs/get:update", "/workspace/selection:update").
  - If CLI needs to trigger GUI file load or selection, map to existing flows (e.g., dispatch a window event like 'workspaceLoaded' with data, or send the exact broadcast channel if one exists).

Approach B: Electron "CLI mode" inside main process
- Detect --cli flag; skip window creation; run commands; print JSON and exit.
- Pros: No socket needed; Cons: No real-time sync to GUI while in CLI-only mode.

Approach C: HTTP API server in main process
- Express or fastify hosting JSON endpoints that map to the same methods as Approach A.
- Pros: Language-agnostic clients; Cons: Heavier surface and security considerations.

This plan proceeds with Approach A.

## Precise Integration Points and Channels

- File scanning (existing):
  - Send: "request-file-list" (args: folderPath, exclusionPatterns[], requestId?)
  - Receive: "file-list-data" batches { files, isComplete?, processed, directories, requestId }
  - Receive status: "file-processing-status" { status: processing|complete|error|idle, message, processed?, total?, directories? }

- File content (legacy path):
  - Invoke: "request-file-content", returns { success, content?, tokenCount?, error? }
  - Secure path alternative: "/file/content" with { workspaceId, filePath, lineRanges? }

- Workspaces (secure path):
  - "/workspace/list" -> Workspace[]
  - "/workspace/create" -> { id, name, folderPath, state, timestamps }
  - "/workspace/load" -> Workspace or null
  - "/workspace/update", "/workspace/touch", "/workspace/delete", "/workspace/rename"
  - Updates broadcast as needed (e.g., via "/workspace/current:update" in StateHandlers)

- Preferences and selection (secure path):
  - "/prefs/get"/"/prefs/set" with updates on "/prefs/get:update"
  - "/workspace/selection"/"/workspace/selection/update|clear" with updates on "/workspace/selection:update"

- Renderer custom DOM events already used:
  - 'workspaceLoaded' dispatched by workspace modal/dropdown, handled by useAppState to trigger a scan

## Security Considerations

- Only bind server on localhost or use a Unix socket in a user-writable directory with safe permissions.
- Require a short-lived bearer token or HMAC challenge for each connection. Store token in user profile dir with 0600 and pass to CLI via env var PASTE_FLOW_CLI_TOKEN.
- Rate-limit at the server and again via SecureIpcLayer where applicable.
- Enforce path validation as main.js does by setting currentWorkspacePaths appropriately before file content ops.

## CLI Command Surface (Phase 1)

- pasteflow workspace list -> map to "/workspace/list"
- pasteflow workspace load <idOrName> -> map to "/workspace/load"; then trigger GUI scan by dispatching the same behavior as renderer: send "request-file-list" with the folder from loaded workspace; optionally broadcast a specific update channel if needed.
- pasteflow scan <folder> [--exclude ...] -> trigger "request-file-list" and either:
  - stream progress lines to stdout using server-sent events, or
  - wait for completion and return the aggregated list
- pasteflow file content <path> [--workspace <id>] [--lines A-B,C-D] -> map to "/file/content" when secure path on; otherwise legacy "request-file-content"
- pasteflow selection set|clear|add|remove -> map to "/workspace/selection/update|clear"

All commands should support --json output.

## Server Bridge Design (Main Process)

- Location: Extend main.js (or a new src/main/cli/cli-server.ts compiled to build/main/cli/cli-server.js) and only initialize if PF_CLI_SERVER=1.
- Transport: Default to TCP 127.0.0.1:8765 in dev; Unix socket at ~/.pasteflow/pasteflow.sock in prod; Windows named pipe fallback.
- Routing table example:
  - methods: {
    "workspace.list": () => ipcOrSecure("/workspace/list", {}),
    "workspace.load": ({ id }) => ipcOrSecure("/workspace/load", { id }),
    "scan.start": ({ folder, exclude, requestId }) => startScan(folder, exclude, requestId),
    "file.content": ({ workspaceId, path, ranges }) => ipcOrSecure("/file/content", { workspaceId, filePath: path, lineRanges: ranges }),
    "selection.update": (payload) => ipcOrSecure("/workspace/selection/update", payload)
  }
- startScan should:
  - set currentWorkspacePaths and call the same logic as request-file-list uses, or simply emit the ipcMain.on("request-file-list") path by simulating the event with a synthetic WebContents? Prefer extracting scanning logic into a function for reuse.
  - Stream partial batches to the CLI client or buffer until complete.

Note: In secure mode, prefer using StateHandlers and SecureIpcLayer directly (they’re constructed with the database). For legacy-only paths (request-file-list), keep using ipcMain logic or refactor the scanning function into a reusable module.

## CLI Client (Standalone)

- Node.js CLI using commander/yargs to parse args.
- Connects to the local server, speaks JSON over the socket.
- Example methods: workspace.list, workspace.load, scan.start, file.content, selection.update
- Provide --json and pretty-printed output; exit codes reflect success.

## Implementation Steps

Phase 0 – Alignment and flags
1) Decide default mode: secure IPC on by default in dev? Define PF_CLI_SERVER env flag.
2) Confirm port/socket path conventions and token placement.

Phase 1 – Minimal server and list/load
1) Add minimal server in main process that exposes workspace.list and workspace.load via secure IPC calls.
2) Implement authentication and simple JSON-RPC routing with error handling and exit codes.
3) Ship a basic CLI with workspace list/load commands.

Phase 2 – File scanning and content
1) Expose scan.start that triggers request-file-list flow. For v1, return final result; for v1.1, add streaming of file-list-data and file-processing-status events.
2) Expose file.content calling secure /file/content (or legacy request-file-content) with path validation.

Phase 3 – Selection and preferences
1) Expose selection.update/clear and "/prefs/get|set" operations.
2) Ensure broadcast updates trigger renderer updates; do not introduce generic "state-update" unless necessary.

Phase 4 – Real-time monitoring (optional)
1) Add a subscription model on the socket to forward specific broadcast channels (e.g., "/workspace/selection:update").
2) CLI command pasteflow monitor to print updates as they arrive.

## Technical Notes and Edge Cases

- Secure vs legacy path: main.js chooses based on SECURE_IPC. The CLI server should detect and, when secure is enabled, use StateHandlers/SecureIpcLayer entry points and channels. Otherwise, fall back to legacy ipcMain handlers and DatabaseBridge.
- Workspace ID vs name: The schemas and handlers support both during migration. The CLI should accept either and surface the resolved ID in responses.
- Path validation: For legacy request-file-content, main.js requires currentWorkspacePaths to be set. Ensure CLI-triggered scans set this before content requests.
- Batch scanning: Existing scanning logic streams batches and status; if providing a synchronous CLI response, aggregate batches until isComplete.
- Cross-platform sockets: Use TCP on Windows to avoid named pipe complexity initially; harden later.
- Permissions: Ensure the socket/token files are user-only readable; rotate token periodically.
- Preload whitelist: For any new renderer listeners introduced, ensure channels are allowed by preload wrappers if using window.electron.receive; direct ipcRenderer.on wrapper in preload already forwards arbitrary channels via ipcRenderer object.

## JSON-RPC Protocol Schema

### Request Format
```typescript
interface CLIRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
  auth?: {
    token: string;
    timestamp: number;
  };
}
```

### Response Format
```typescript
interface CLIResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface CLIStreamEvent {
  jsonrpc: "2.0";
  method: string; // e.g., "scan.progress", "scan.batch"
  params: {
    requestId: string;
    data: unknown;
  };
}
```

### Error Codes
```typescript
enum CLIErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // Custom PasteFlow errors
  AUTH_REQUIRED = -32000,
  AUTH_INVALID = -32001,
  RATE_LIMITED = -32002,
  WORKSPACE_NOT_FOUND = -32003,
  PATH_VALIDATION_FAILED = -32004,
  FILE_NOT_FOUND = -32005,
  BINARY_FILE = -32006,
  SCAN_IN_PROGRESS = -32007,
  ELECTRON_NOT_READY = -32008
}
```

### Method Definitions
```typescript
interface MethodRegistry {
  // Workspace operations
  "workspace.list": {
    params: {};
    result: Workspace[];
  };

  "workspace.load": {
    params: { id: string };
    result: Workspace | null;
  };

  "workspace.create": {
    params: { name: string; folderPath: string; state?: WorkspaceState };
    result: Workspace;
  };

  "workspace.update": {
    params: { id: string; state: WorkspaceState };
    result: boolean;
  };

  "workspace.delete": {
    params: { id: string };
    result: boolean;
  };

  // File operations
  "scan.start": {
    params: {
      folder: string;
      exclude?: string[];
      stream?: boolean; // If true, use streaming responses
      requestId?: string;
    };
    result: ScanResult | { requestId: string }; // Immediate or streaming
  };

  "scan.cancel": {
    params: { requestId: string };
    result: boolean;
  };

  "file.content": {
    params: {
      path: string;
      workspaceId?: string;
      lines?: Array<{ start: number; end: number }>;
    };
    result: { content: string; tokenCount: number; hash?: string };
  };

  // Selection operations
  "selection.get": {
    params: {};
    result: { selectedFiles: SelectedFile[]; lastModified: number };
  };

  "selection.update": {
    params: { selectedFiles: SelectedFile[]; lastModified?: number };
    result: boolean;
  };

  "selection.clear": {
    params: {};
    result: boolean;
  };

  // Preferences
  "prefs.get": {
    params: { key: string };
    result: unknown;
  };

  "prefs.set": {
    params: { key: string; value: unknown; encrypted?: boolean };
    result: boolean;
  };

  // Monitoring/subscriptions
  "monitor.subscribe": {
    params: { channels: string[] }; // e.g., ["/workspace/selection:update"]
    result: { subscriptionId: string };
  };

  "monitor.unsubscribe": {
    params: { subscriptionId: string };
    result: boolean;
  };

  // System operations
  "system.status": {
    params: {};
    result: {
      version: string;
      secure: boolean;
      database: boolean;
      activeWorkspace?: string;
    };
  };
}
```

## Protocol Validation (Zod)

Example Zod schemas to validate JSON-RPC envelopes and key method params. These live on the server and should be applied before routing.

```typescript
import { z } from 'zod';

export const AuthSchema = z.object({
  token: z.string().min(16),
  timestamp: z.number().int() // ms since epoch; enforce drift window on server
});

export const JsonRpcBase = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()])
});

export const CLIRequestSchema = JsonRpcBase.extend({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  auth: AuthSchema.optional()
});

export const CLIErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional()
});

export const CLIResponseSchema = JsonRpcBase.extend({
  result: z.unknown().optional(),
  error: CLIErrorSchema.optional()
});

// Method-specific param schemas
export const WorkspaceLoadParams = z.object({ id: z.string().min(1) });

export const ScanStartParams = z.object({
  folder: z.string().min(1),
  exclude: z.array(z.string()).optional(),
  stream: z.boolean().default(false),
  requestId: z.string().optional()
});

export const FileContentParams = z.object({
  path: z.string().min(1),
  workspaceId: z.string().optional(),
  lines: z.array(z.object({ start: z.number().int().positive(), end: z.number().int().positive() })).optional()
});

export const SelectionUpdateParams = z.object({
  selectedFiles: z.array(z.object({
    path: z.string(),
    lines: z.array(z.object({ start: z.number().int().positive(), end: z.number().int().positive() })).optional(),
    isFullFile: z.boolean().optional()
  })),
  lastModified: z.number().int().optional()
});

// Registry mapping for routing + validation
export const MethodParamSchemas: Record<string, z.ZodTypeAny | undefined> = {
  'workspace.list': z.object({}).passthrough(),
  'workspace.load': WorkspaceLoadParams,
  'workspace.create': z.object({ name: z.string().min(1), folderPath: z.string().min(1), state: z.record(z.string(), z.unknown()).optional() }),
  'workspace.update': z.object({ id: z.string().min(1), state: z.record(z.string(), z.unknown()) }),
  'workspace.delete': z.object({ id: z.string().min(1) }),
  'scan.start': ScanStartParams,
  'scan.cancel': z.object({ requestId: z.string().min(1) }),
  'file.content': FileContentParams,
  'selection.get': z.object({}).passthrough(),
  'selection.update': SelectionUpdateParams,
  'selection.clear': z.object({}).passthrough(),
  'prefs.get': z.object({ key: z.string().min(1) }),
  'prefs.set': z.object({ key: z.string().min(1), value: z.unknown(), encrypted: z.boolean().optional() }),
  'monitor.subscribe': z.object({ channels: z.array(z.string()).min(1) }),
  'monitor.unsubscribe': z.object({ subscriptionId: z.string().min(1) }),
  'system.status': z.object({}).passthrough()
};

// Example guard
export function validateRequest(req: unknown) {
  const parsed = CLIRequestSchema.parse(req);
  const methodSchema = MethodParamSchemas[parsed.method];
  if (methodSchema) {
    methodSchema.parse(parsed.params ?? {});
  }
  return parsed;
}
```

## Channel-to-Command Matrix

| CLI Command | JSON-RPC Method | IPC Channel/Handler | Broadcast Channel | Notes |
|-------------|-----------------|---------------------|-------------------|-------|
| `pasteflow workspace list` | `workspace.list` | `/workspace/list` (secure) or legacy handler | - | Returns all workspaces |
| `pasteflow workspace load <id>` | `workspace.load` | `/workspace/load` | May trigger scan via `request-file-list` | Loads workspace and optionally scans folder |
| `pasteflow workspace create <name> <path>` | `workspace.create` | `/workspace/create` | `/workspace/current:update` | Creates new workspace |
| `pasteflow workspace update <id>` | `workspace.update` | `/workspace/update` | `/workspace/current:update` | Updates workspace state |
| `pasteflow workspace delete <id>` | `workspace.delete` | `/workspace/delete` | - | Deletes workspace |
| `pasteflow scan <folder>` | `scan.start` | `request-file-list` (legacy) | `file-list-data`, `file-processing-status` | Scans directory for files |
| `pasteflow scan --cancel <id>` | `scan.cancel` | `cancel-file-loading` | `file-processing-status` | Cancels active scan |
| `pasteflow file content <path>` | `file.content` | `/file/content` (secure) or `request-file-content` | - | Gets file content with token count |
| `pasteflow selection list` | `selection.get` | `/workspace/selection` | - | Gets current file selection |
| `pasteflow selection add <path>` | `selection.update` | `/workspace/selection/update` | `/workspace/selection:update` | Adds files to selection |
| `pasteflow selection clear` | `selection.clear` | `/workspace/selection/clear` | `/workspace/selection:update` | Clears file selection |
| `pasteflow prefs get <key>` | `prefs.get` | `/prefs/get` | - | Gets preference value |
| `pasteflow prefs set <key> <value>` | `prefs.set` | `/prefs/set` | `/prefs/get:update` | Sets preference value |
| `pasteflow monitor` | `monitor.subscribe` | - | Various `:update` channels | Monitors for real-time updates |
| `pasteflow status` | `system.status` | - | - | Shows system status |

## CLI Server Test Plans

### Unit Tests

#### Authentication Tests
```typescript
describe('CLI Server Authentication', () => {
  test('should reject requests without auth token', async () => {
    const request = { jsonrpc: "2.0", id: 1, method: "workspace.list" };
    const response = await server.handleRequest(request);
    expect(response.error?.code).toBe(CLIErrorCode.AUTH_REQUIRED);
  });

  test('should reject requests with invalid token', async () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "workspace.list",
      auth: { token: "invalid", timestamp: Date.now() }
    };
    const response = await server.handleRequest(request);
    expect(response.error?.code).toBe(CLIErrorCode.AUTH_INVALID);
  });

  test('should accept requests with valid token', async () => {
    const validToken = await generateToken();
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "system.status",
      auth: { token: validToken, timestamp: Date.now() }
    };
    const response = await server.handleRequest(request);
    expect(response.result).toBeDefined();
  });

  test('should reject expired tokens', async () => {
    const expiredToken = await generateToken();
    // Simulate time passing
    jest.advanceTimersByTime(TOKEN_EXPIRY + 1000);

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "workspace.list",
      auth: { token: expiredToken, timestamp: Date.now() - TOKEN_EXPIRY - 1000 }
    };
    const response = await server.handleRequest(request);
    expect(response.error?.code).toBe(CLIErrorCode.AUTH_INVALID);
  });
});
```

#### Rate Limiting Tests
```typescript
describe('CLI Server Rate Limiting', () => {
  test('should allow requests within rate limit', async () => {
    const token = await generateToken();

    for (let i = 0; i < RATE_LIMIT_PER_MINUTE - 1; i++) {
      const response = await server.handleRequest({
        jsonrpc: "2.0", id: i, method: "system.status",
        auth: { token, timestamp: Date.now() }
      });
      expect(response.error).toBeUndefined();
    }
  });

  test('should reject requests exceeding rate limit', async () => {
    const token = await generateToken();

    // Exhaust rate limit
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await server.handleRequest({
        jsonrpc: "2.0", id: i, method: "system.status",
        auth: { token, timestamp: Date.now() }
      });
    }

    // This should be rate limited
    const response = await server.handleRequest({
      jsonrpc: "2.0", id: 999, method: "system.status",
      auth: { token, timestamp: Date.now() }
    });
    expect(response.error?.code).toBe(CLIErrorCode.RATE_LIMITED);
  });
});
```

#### Method Routing Tests
```typescript
describe('CLI Server Method Routing', () => {
  test('should route workspace.list to secure IPC handler', async () => {
    const mockSecureHandler = jest.fn().mockResolvedValue([]);
    server.setSecureHandler('/workspace/list', mockSecureHandler);

    const response = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "workspace.list", params: {}
    });

    expect(mockSecureHandler).toHaveBeenCalledWith({});
    expect(response.result).toEqual([]);
  });

  test('should fallback to legacy handler when secure not available', async () => {
    server.setSecureMode(false);
    const mockLegacyHandler = jest.fn().mockResolvedValue([]);
    server.setLegacyHandler('workspace.list', mockLegacyHandler);

    const response = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "workspace.list", params: {}
    });

    expect(mockLegacyHandler).toHaveBeenCalled();
  });

  test('should return method not found for unknown methods', async () => {
    const response = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "unknown.method", params: {}
    });

    expect(response.error?.code).toBe(CLIErrorCode.METHOD_NOT_FOUND);
  });
});
```

### Integration Tests

#### File Scanning Integration
```typescript
describe('File Scanning Integration', () => {
  test('should complete full scan workflow', async () => {
    const testFolder = await createTestDirectory();
    const events: any[] = [];

    // Mock file-list-data and file-processing-status events
    server.on('scan.batch', (data) => events.push({ type: 'batch', data }));
    server.on('scan.progress', (data) => events.push({ type: 'progress', data }));

    const response = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "scan.start",
      params: { folder: testFolder, stream: true }
    });

    expect(response.result?.requestId).toBeDefined();

    // Wait for scan completion
    await waitForScanCompletion(response.result.requestId);

    // Verify we received progress and batch events
    expect(events.some(e => e.type === 'progress')).toBe(true);
    expect(events.some(e => e.type === 'batch')).toBe(true);

    // Verify final batch has isComplete: true
    const finalBatch = events.filter(e => e.type === 'batch').pop();
    expect(finalBatch?.data.isComplete).toBe(true);
  });

  test('should handle scan cancellation', async () => {
    const testFolder = await createLargeTestDirectory();

    const startResponse = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "scan.start",
      params: { folder: testFolder, stream: true }
    });

    const requestId = startResponse.result?.requestId;
    expect(requestId).toBeDefined();

    // Cancel immediately
    const cancelResponse = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 2, method: "scan.cancel",
      params: { requestId }
    });

    expect(cancelResponse.result).toBe(true);

    // Verify scan was actually cancelled
    await new Promise(resolve => setTimeout(resolve, 100));
    const status = await server.getScanStatus(requestId);
    expect(status).toBe('cancelled');
  });
});
```

#### Workspace Integration
```typescript
describe('Workspace Integration', () => {
  test('should create, load, and delete workspace', async () => {
    const testFolder = await createTestDirectory();

    // Create workspace
    const createResponse = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "workspace.create",
      params: { name: "test-workspace", folderPath: testFolder }
    });

    expect(createResponse.result?.id).toBeDefined();
    const workspaceId = createResponse.result.id;

    // Load workspace
    const loadResponse = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 2, method: "workspace.load",
      params: { id: workspaceId }
    });

    expect(loadResponse.result?.name).toBe("test-workspace");
    expect(loadResponse.result?.folderPath).toBe(testFolder);

    // Delete workspace
    const deleteResponse = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 3, method: "workspace.delete",
      params: { id: workspaceId }
    });

    expect(deleteResponse.result).toBe(true);

    // Verify deletion
    const loadAfterDelete = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 4, method: "workspace.load",
      params: { id: workspaceId }
    });

    expect(loadAfterDelete.result).toBeNull();
  });
});
```

### End-to-End CLI Tests

#### CLI Command Tests
```typescript
describe('CLI End-to-End', () => {
  test('should execute workspace list command', async () => {
    const result = await execCLI(['workspace', 'list', '--json']);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(Array.isArray(output)).toBe(true);
  });

  test('should handle authentication errors gracefully', async () => {
    // Remove auth token
    delete process.env.PASTE_FLOW_CLI_TOKEN;

    const result = await execCLI(['workspace', 'list']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Authentication required');
  });

  test('should execute scan with progress output', async () => {
    const testFolder = await createTestDirectory();

    const result = await execCLI(['scan', testFolder, '--progress']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Scanning');
    expect(result.stdout).toContain('Complete');
  });

  test('should handle file content with line ranges', async () => {
    const testFile = await createTestFile('test.js', 'line1\nline2\nline3\n');

    const result = await execCLI([
      'file', 'content', testFile,
      '--lines', '2-3',
      '--json'
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.content).toBe('line2\nline3');
  });
});
```

### Performance Tests

#### Load Testing
```typescript
describe('CLI Server Performance', () => {
  test('should handle concurrent requests', async () => {
    const concurrentRequests = 50;
    const promises = [];

    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(server.handleAuthenticatedRequest({
        jsonrpc: "2.0", id: i, method: "system.status", params: {}
      }));
    }

    const results = await Promise.all(promises);

    // All requests should succeed
    results.forEach(result => {
      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
    });
  });

  test('should handle large file scans efficiently', async () => {
    const largeFolder = await createLargeFolderStructure(1000); // 1000 files

    const startTime = Date.now();
    const response = await server.handleAuthenticatedRequest({
      jsonrpc: "2.0", id: 1, method: "scan.start",
      params: { folder: largeFolder }
    });
    const endTime = Date.now();

    expect(response.result?.files).toBeDefined();
    expect(response.result.files.length).toBe(1000);
    expect(endTime - startTime).toBeLessThan(5000); // Should complete in <5s
  });
});
```

## Additional Critical Enhancements

### 1. Connection Management & Lifecycle

#### Server Lifecycle
```typescript
interface ServerLifecycle {
  startup(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getMetrics(): ServerMetrics;
}

interface ServerMetrics {
  uptime: number;
  requestCount: number;
  errorCount: number;
  activeConnections: number;
  memoryUsage: NodeJS.MemoryUsage;
}
```

#### Connection Pooling
- Limit concurrent connections (default: 10)
- Connection timeout handling (30s idle timeout)
- Graceful connection cleanup on server shutdown
- WebSocket upgrade support for streaming operations

### 2. Advanced Security Features

#### Token Management
```typescript
interface TokenManager {
  generateToken(ttl?: number): Promise<string>;
  validateToken(token: string): Promise<boolean>;
  revokeToken(token: string): Promise<void>;
  rotateTokens(): Promise<void>;
  cleanupExpiredTokens(): Promise<void>;
}
```

#### Request Signing
- HMAC-SHA256 request signing for critical operations
- Nonce-based replay attack prevention
- Client certificate support for enterprise deployments

#### Audit Logging
```typescript
interface AuditLogger {
  logRequest(request: CLIRequest, clientInfo: ClientInfo): void;
  logResponse(response: CLIResponse, duration: number): void;
  logError(error: Error, context: RequestContext): void;
  logSecurityEvent(event: SecurityEvent): void;
}
```

### 3. Configuration Management

#### Server Configuration
```typescript
interface ServerConfig {
  transport: {
    type: 'tcp' | 'unix' | 'pipe';
    host?: string;
    port?: number;
    socketPath?: string;
    pipeName?: string;
  };
  security: {
    tokenTTL: number;
    rateLimitPerMinute: number;
    maxConcurrentConnections: number;
    requireAuth: boolean;
    allowedOrigins?: string[];
  };
  features: {
    enableStreaming: boolean;
    enableMonitoring: boolean;
    enableFileOperations: boolean;
    maxScanDepth: number;
    maxFileSize: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    auditEnabled: boolean;
    metricsEnabled: boolean;
  };
}
```

### 4. Error Recovery & Resilience

#### Circuit Breaker Pattern
```typescript
interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  getState(): 'closed' | 'open' | 'half-open';
  getMetrics(): CircuitBreakerMetrics;
}
```

#### Retry Logic
- Exponential backoff for transient failures
- Dead letter queue for failed operations
- Graceful degradation when database is unavailable

### 5. Monitoring & Observability

#### Metrics Collection
```typescript
interface MetricsCollector {
  incrementCounter(name: string, tags?: Record<string, string>): void;
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
  recordGauge(name: string, value: number, tags?: Record<string, string>): void;
  startTimer(name: string): Timer;
}
```

#### Health Checks
- Database connectivity check
- File system access check
- Memory usage monitoring
- Response time monitoring

### 6. CLI Client Enhancements

#### Configuration File Support
```yaml
# ~/.pasteflow/cli-config.yaml
server:
  endpoint: "unix:///tmp/pasteflow.sock"
  timeout: 30s
  retries: 3

auth:
  token_file: "~/.pasteflow/token"
  auto_refresh: true

output:
  format: "json" # json, yaml, table
  color: true
  verbose: false

aliases:
  ws: workspace
  sel: selection
```

#### Interactive Mode
```bash
$ pasteflow interactive
PasteFlow CLI v1.0.0
> workspace list
> scan ./src --exclude "*.test.js"
> selection add src/main.js:10-50
> exit
```

#### Shell Completion
- Bash/Zsh/Fish completion scripts
- Dynamic completion for workspace names, file paths
- Context-aware suggestions

### 7. Plugin Architecture

#### Plugin Interface
```typescript
interface CLIPlugin {
  name: string;
  version: string;
  commands: PluginCommand[];
  hooks: PluginHooks;

  initialize(context: PluginContext): Promise<void>;
  cleanup(): Promise<void>;
}

interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string[], context: CommandContext) => Promise<void>;
}
```

#### Built-in Plugins
- Export plugin (JSON, XML, Markdown formats)
- Git integration plugin (workspace from git repos)
- Template plugin (project scaffolding)
- Analytics plugin (usage statistics)

## Enhanced Deliverables

### Core Implementation
- **CLI Server** (`src/main/cli/server.ts`): JSON-RPC server with auth, rate limiting, method routing
- **CLI Client** (`cli/pasteflow-cli.js`): Standalone Node.js CLI with rich command set
- **Protocol Library** (`src/main/cli/protocol-schemas.ts`): Shared Zod types, error codes, and validation helpers
- **Configuration** (`config/cli-server.yaml`): Server configuration schema

### Developer On-Ramp (for junior engineers)
- Start by reading `src/main/cli/protocol-schemas.ts` to understand request/response and typed method params/results
- Implement minimal `src/main/cli/server.ts` with:
  - TCP listener on 127.0.0.1:8765 (dev), single connection handler, JSON lines protocol (\n-delimited)
  - Validate incoming messages via `CLIRequestSchema`
  - Route `workspace.list` and `system.status` using secure IPC if available, else legacy
  - Return validated responses via `CLIResponseSchema`
- Wire PF_CLI_SERVER=1 gate in `main.js` to initialize the server after app.whenReady
- Use `cli/pasteflow-cli.js` to manually test `workspace list` and `workspace load`

### Security & Operations
- **Token Manager** (`src/main/cli/auth.ts`): Token generation, validation, rotation
- **Audit Logger** (`src/main/cli/audit.ts`): Security event logging
- **Metrics Collector** (`src/main/cli/metrics.ts`): Performance monitoring
- **Health Checker** (`src/main/cli/health.ts`): System health monitoring

### Testing & Quality
- **Unit Tests**: 95%+ coverage for server, client, and protocol layers
- **Integration Tests**: End-to-end workflow testing
- **Performance Tests**: Load testing, memory profiling
- **Security Tests**: Penetration testing, vulnerability scanning

### Documentation & Tooling
- **API Documentation**: OpenAPI spec for JSON-RPC methods
- **CLI Manual**: Comprehensive command reference
- **Deployment Guide**: Production deployment best practices
- **Troubleshooting Guide**: Common issues and solutions

## Revised Timeline (Enhanced Scope)

### Phase 1: Foundation (Weeks 1-2)
- Core server architecture with JSON-RPC protocol
- Authentication and authorization system
- Basic workspace and system commands
- Unit test framework setup

### Phase 2: Core Features (Weeks 3-4)
- File scanning with streaming support
- File content operations with line range support
- Selection management
- Integration test suite

### Phase 3: Advanced Features (Weeks 5-6)
- Real-time monitoring and subscriptions
- Configuration management system
- Error recovery and resilience features
- Performance optimization

### Phase 4: Production Readiness (Weeks 7-8)
- Security hardening and audit logging
- Comprehensive documentation
- CLI client enhancements (interactive mode, completion)
- Load testing and performance tuning

### Phase 5: Extensions (Weeks 9-10)
- Plugin architecture implementation
- Built-in plugins (export, git integration)
- Advanced CLI features (aliases, profiles)
- Beta testing and feedback incorporation

**Total Timeline: 10 weeks for full-featured, production-ready CLI integration**

