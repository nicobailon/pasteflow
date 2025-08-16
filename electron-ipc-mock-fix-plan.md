# Electron IPC Renderer Mock Fix - Investigation & Solution Plan

## Status: Immediate Fix Applied ✅

### Quick Summary
The critical IPC mock issue has been resolved. Tests that were failing due to `window.electron.ipcRenderer.invoke is not a function` are now working correctly.

### What Was Fixed
- Added the missing `invoke` method to the Electron IPC mock in `jest.setup.js`
- Implemented default mock responses for all identified IPC channels
- Tests can now properly mock promise-based IPC communication

### Verified Working
- ✅ Workspace cache manager tests: All 27 tests passing
- ✅ IPC invoke calls no longer throw "not a function" errors
- ✅ Mock handles all database, instruction, preference, and file operations

### Remaining Issues (Separate Problems)
1. **Lucide React Icons**: Components using `Clock`, `SortAsc`, `GripVertical` are undefined
   - Location: `src/components/workspace-header.tsx`
   - This is a separate module import/mock issue, not related to IPC
   
2. **Import.meta.url**: Worker pool using ES module syntax
   - Location: `src/utils/tree-builder-worker-pool.ts`
   - Jest configuration may need adjustment for ES modules

3. **React act() warnings**: State updates in tests need proper wrapping
   - These are warnings, not errors
   - Tests still pass despite these warnings

## Investigation Summary

### Root Cause
The test failures are occurring because `window.electron.ipcRenderer.invoke` is not properly mocked in the Jest setup, while the application code heavily relies on this method for promise-based IPC communication.

### Current State Analysis

#### 1. Mock Configuration Issue
**Location**: `/jest.setup.js:65-74`
```javascript
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      send: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn()
      // Missing: invoke method
    }
  },
  writable: true
});
```

#### 2. Actual Interface Implementation
**Location**: `/preload.js:100-109`
```javascript
invoke: async (channel, data) => {
  try {
    const serializedData = ensureSerializable(data);
    const result = await ipcRenderer.invoke(channel, serializedData);
    return ensureSerializable(result);
  } catch (error) {
    console.error(`Error invoking IPC channel ${channel}:`, error);
    throw error;
  }
}
```

#### 3. Usage Patterns Identified

The `invoke` method is used extensively throughout the codebase for:

##### Database Operations (Primary Usage)
- `/workspace/list` - List all workspaces
- `/workspace/load` - Load specific workspace
- `/workspace/create` - Create new workspace
- `/workspace/update` - Update existing workspace
- `/workspace/delete` - Delete workspace
- `/workspace/touch` - Update last accessed timestamp
- `/workspace/rename` - Rename workspace

##### Instructions Management
- `/instructions/list` - List all instructions
- `/instructions/create` - Create new instruction
- `/instructions/update` - Update instruction
- `/instructions/delete` - Delete instruction

##### Preferences
- `/prefs/get` - Get preference value
- `/prefs/set` - Set preference value

##### File Operations
- `request-file-content` - Request file content with token counting

## Solution Plan

### Phase 1: Immediate Fix (Critical - Unblock Tests)

#### 1.1 Update Jest Setup Mock
Add the missing `invoke` method to the mock with intelligent default behavior:

```javascript
// jest.setup.js
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      send: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      invoke: jest.fn().mockImplementation((channel, data) => {
        // Provide sensible defaults based on channel patterns
        if (channel.startsWith('/workspace/')) {
          return Promise.resolve(getMockWorkspaceResponse(channel, data));
        }
        if (channel.startsWith('/instructions/')) {
          return Promise.resolve(getMockInstructionsResponse(channel, data));
        }
        if (channel.startsWith('/prefs/')) {
          return Promise.resolve(getMockPrefsResponse(channel, data));
        }
        if (channel === 'request-file-content') {
          return Promise.resolve({
            success: true,
            content: 'mock file content',
            tokenCount: 100
          });
        }
        return Promise.resolve(null);
      })
    }
  },
  writable: true,
  configurable: true
});
```

### Phase 2: Test Infrastructure Enhancement

#### 2.1 Create Test Helper Module
Create `/src/__tests__/helpers/electron-mock-helpers.ts`:

```typescript
export interface ElectronMockConfig {
  workspaces?: Array<DatabaseWorkspace>;
  instructions?: Array<Instruction>;
  preferences?: Record<string, any>;
  fileContentResponses?: Map<string, { content: string; tokenCount: number }>;
}

export function setupElectronMocks(config: ElectronMockConfig = {}) {
  // Reset and configure mocks based on test needs
}

export function createMockWorkspace(overrides?: Partial<WorkspaceState>): WorkspaceState {
  // Factory for creating test workspaces
}

export function createMockInstruction(overrides?: Partial<Instruction>): Instruction {
  // Factory for creating test instructions
}
```

#### 2.2 Update Existing Test Files
Modify test files to properly set up mocks before tests:

```typescript
beforeEach(() => {
  setupElectronMocks({
    workspaces: [createMockWorkspace({ name: 'test-workspace' })],
    instructions: [],
    preferences: { 'workspace-sort-mode': 'alphabetical' }
  });
});
```

### Phase 3: Long-term Improvements

#### 3.1 Create Mock Adapter Pattern
Implement a mock adapter that can switch between different mock implementations:

```typescript
// src/__tests__/mocks/electron-ipc-mock-adapter.ts
export class ElectronIPCMockAdapter {
  private mockStrategies: Map<string, MockStrategy>;
  
  constructor() {
    this.mockStrategies = new Map([
      ['workspace', new WorkspaceMockStrategy()],
      ['instructions', new InstructionsMockStrategy()],
      ['prefs', new PrefsMockStrategy()],
      ['file', new FileMockStrategy()]
    ]);
  }
  
  async invoke(channel: string, data: any): Promise<any> {
    const strategy = this.findStrategy(channel);
    return strategy.handle(channel, data);
  }
}
```

#### 3.2 Type Safety for Mocks
Ensure mock responses match actual IPC handler return types:

```typescript
// src/__tests__/types/mock-types.ts
export type MockIPCHandlers = {
  '/workspace/list': () => Promise<DatabaseWorkspace[]>;
  '/workspace/load': (data: { id: string }) => Promise<WorkspaceState | null>;
  '/workspace/create': (data: { name: string; state: WorkspaceState }) => Promise<void>;
  // ... etc
};
```

### Phase 4: Testing Strategy

#### 4.1 Unit Test Categories
1. **IPC Communication Tests**: Verify mock setup and teardown
2. **State Management Tests**: Test workspace/instruction operations
3. **Integration Tests**: Full workflow tests with mocked IPC
4. **Error Handling Tests**: Verify graceful failure scenarios

#### 4.2 Test Coverage Requirements
- All IPC channels must have corresponding mock implementations
- Mock responses must match production response schemas
- Error scenarios must be testable via mock configuration

### Implementation Steps

1. **Immediate (Today)**
   - [x] Update `jest.setup.js` with `invoke` mock - **COMPLETED**
   - [ ] Fix import issues in test files (separate issue with lucide-react icons)
   - [x] Verify IPC-related tests pass with basic mock - **CONFIRMED WORKING**

2. **Short-term (This Week)**
   - [ ] Create electron mock helpers module
   - [ ] Update critical test files to use new helpers
   - [ ] Add comprehensive mock response factories

3. **Medium-term (Next Sprint)**
   - [ ] Implement mock adapter pattern
   - [ ] Add type safety to all mock responses
   - [ ] Create test documentation for mock usage

4. **Long-term (Future)**
   - [ ] Consider using MSW for more realistic IPC mocking
   - [ ] Add performance testing for IPC operations
   - [ ] Create automated mock validation against actual handlers

## Risk Mitigation

### Potential Risks
1. **Mock Drift**: Mocks becoming out of sync with actual IPC handlers
2. **Over-mocking**: Tests passing but real functionality broken
3. **Performance**: Complex mocks slowing down test execution

### Mitigation Strategies
1. **Schema Validation**: Use shared types between handlers and mocks
2. **Integration Tests**: Maintain a suite of tests that use real IPC when possible
3. **Mock Simplicity**: Keep mocks simple and focused on behavior, not implementation
4. **Regular Audits**: Periodic review of mock accuracy against production code

## Success Criteria

1. **Immediate**: All tests pass without errors
2. **Quality**: No false positives - tests fail when actual bugs exist
3. **Maintainability**: Easy to update mocks when IPC interface changes
4. **Performance**: Test suite runs in < 30 seconds
5. **Developer Experience**: Clear error messages when mocks are misconfigured

## Rollback Plan

If the fix causes unexpected issues:
1. Revert `jest.setup.js` changes
2. Skip failing tests temporarily with clear TODOs
3. Create isolated test environment for gradual migration
4. Document known test limitations

## Monitoring & Validation

Post-implementation checks:
1. Run full test suite: `npm test`
2. Check test coverage: `npm run test:coverage`
3. Verify no console errors/warnings in test output
4. Manual testing of critical workflows in development mode
5. CI/CD pipeline validation

## Notes

- The `invoke` method is critical for all database operations in the application
- Current test failures are blocking CI/CD pipeline
- Fix must be backward compatible with existing test structure
- Consider creating a test-specific IPC channel documentation

## References

- Electron IPC Documentation: https://www.electronjs.org/docs/latest/api/ipc-renderer
- Jest Mocking: https://jestjs.io/docs/mock-functions
- Testing Library Best Practices: https://testing-library.com/docs/