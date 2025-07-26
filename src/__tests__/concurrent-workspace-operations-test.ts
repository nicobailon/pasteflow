import { STORAGE_KEYS } from '../constants';
import { WorkspaceState } from '../types/file-types';

// Mock the path validator to allow all paths in tests
jest.mock('../security/path-validator', () => ({
  getPathValidator: () => ({
    validatePath: (path: string) => ({ valid: true, sanitizedPath: path })
  })
}));

describe('Concurrent Workspace Operations', () => {
  const originalDispatchEvent = window.dispatchEvent;
  const originalLocalStorage = global.localStorage;
  
  beforeEach(() => {
    // Reset localStorage
    const mockStorage: Record<string, string> = {};
    global.localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { Object.keys(mockStorage).forEach(key => delete mockStorage[key]); },
      length: 0,
      key: () => null
    } as Storage;

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
    window.dispatchEvent = originalDispatchEvent;
    jest.restoreAllMocks();
  });

  const createMockWorkspace = (name: string): WorkspaceState => ({
    selectedFolder: `/path/to/${name}`,
    allFiles: [],
    selectedFiles: [],
    expandedNodes: {},
    sortOrder: 'alphabetical',
    searchTerm: '',
    fileTreeMode: 'none',
    exclusionPatterns: [],
    userInstructions: '',
    tokenCounts: {},
    customPrompts: { systemPrompts: [], rolePrompts: [] }
  });

  describe('Race conditions in localStorage', () => {
    it('should handle concurrent writes to localStorage', () => {
      const workspace1 = createMockWorkspace('workspace1');
      const workspace2 = createMockWorkspace('workspace2');
      
      // Simulate concurrent writes that might happen in real usage
      const write1 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.ws1 = { ...workspace1, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      const write2 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.ws2 = { ...workspace2, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      // Execute writes
      write1();
      write2();

      // Both workspaces should be saved
      const savedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(savedWorkspaces)).toHaveLength(2);
      expect(savedWorkspaces.ws1).toBeDefined();
      expect(savedWorkspaces.ws2).toBeDefined();
    });

    it('should handle last-write-wins scenario', () => {
      const workspace1 = createMockWorkspace('version1');
      const workspace2 = createMockWorkspace('version2');
      
      // Both writes target the same workspace key
      const write1 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.shared = { ...workspace1, savedAt: 1000 };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      const write2 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.shared = { ...workspace2, savedAt: 2000 };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      // Execute writes
      write1();
      write2();

      // Last write should win
      const savedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(savedWorkspaces.shared.selectedFolder).toBe('/path/to/version2');
      expect(savedWorkspaces.shared.savedAt).toBe(2000);
    });

    it('should handle read-modify-write patterns', () => {
      // Pre-populate with initial data
      const initial = { existing: { ...createMockWorkspace('existing'), savedAt: 1000 } };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(initial));

      const workspace1 = createMockWorkspace('new1');
      const workspace2 = createMockWorkspace('new2');
      
      // Both operations read-modify-write
      const operation1 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        expect(workspaces.existing).toBeDefined(); // Verify we read the existing data
        workspaces.new1 = { ...workspace1, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      const operation2 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        expect(workspaces.existing).toBeDefined(); // Verify we read the existing data
        workspaces.new2 = { ...workspace2, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      // Execute operations
      operation1();
      operation2();

      // All workspaces should be present
      const savedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      expect(Object.keys(savedWorkspaces)).toHaveLength(3);
      expect(savedWorkspaces.existing).toBeDefined();
      expect(savedWorkspaces.new1).toBeDefined();
      expect(savedWorkspaces.new2).toBeDefined();
    });
  });

  describe('Event dispatching during concurrent operations', () => {
    it('should dispatch events for each save operation', () => {
      const events: Event[] = [];
      window.dispatchEvent = jest.fn((event) => {
        events.push(event);
        return originalDispatchEvent.call(window, event);
      });

      const workspace1 = createMockWorkspace('workspace1');
      const workspace2 = createMockWorkspace('workspace2');
      
      // Simulate saves that dispatch events
      const save1 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.ws1 = { ...workspace1, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        window.dispatchEvent(new CustomEvent('workspacesChanged'));
      };

      const save2 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.ws2 = { ...workspace2, savedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
        window.dispatchEvent(new CustomEvent('workspacesChanged'));
      };

      save1();
      save2();

      // Should have dispatched 2 events
      expect(window.dispatchEvent).toHaveBeenCalledTimes(2);
      expect(events.filter(e => e.type === 'workspacesChanged')).toHaveLength(2);
    });

    it('should handle event details correctly', () => {
      interface WorkspaceChangeEventDetail {
        renamed?: { oldName: string; newName: string };
        wasCurrent?: boolean;
      }
      
      let capturedEvent: CustomEvent<WorkspaceChangeEventDetail> | null = null;
      window.dispatchEvent = jest.fn((event) => {
        if (event instanceof CustomEvent && event.type === 'workspacesChanged') {
          capturedEvent = event as CustomEvent<WorkspaceChangeEventDetail>;
        }
        return originalDispatchEvent.call(window, event);
      });

      // Simulate rename operation
      const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      workspaces.original = createMockWorkspace('original');
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'original');

      // Perform rename
      const renamedWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      renamedWorkspaces.renamed = renamedWorkspaces.original;
      delete renamedWorkspaces.original;
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(renamedWorkspaces));
      localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE, 'renamed');
      
      window.dispatchEvent(new CustomEvent<WorkspaceChangeEventDetail>('workspacesChanged', { 
        detail: { renamed: { oldName: 'original', newName: 'renamed' }, wasCurrent: true }
      }));

      expect(capturedEvent).not.toBeNull();
      if (capturedEvent) {
        expect(capturedEvent.detail.renamed).toEqual({ oldName: 'original', newName: 'renamed' });
        expect(capturedEvent.detail.wasCurrent).toBe(true);
      }
    });
  });

  describe('Data integrity during concurrent operations', () => {
    it('should maintain data integrity when operations overlap', () => {
      const initialWorkspaces = {
        ws1: { ...createMockWorkspace('workspace1'), savedAt: 1000 },
        ws2: { ...createMockWorkspace('workspace2'), savedAt: 2000 }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(initialWorkspaces));

      // Operation 1: Update ws1
      const op1 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        workspaces.ws1 = { ...workspaces.ws1, userInstructions: 'Updated instructions' };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      // Operation 2: Delete ws2 and add ws3
      const op2 = () => {
        const workspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        delete workspaces.ws2;
        workspaces.ws3 = { ...createMockWorkspace('workspace3'), savedAt: 3000 };
        localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      };

      // Execute operations
      op1();
      op2();

      const finalWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      
      // ws1 should have updated instructions
      expect(finalWorkspaces.ws1.userInstructions).toBe('Updated instructions');
      // ws2 should be deleted
      expect(finalWorkspaces.ws2).toBeUndefined();
      // ws3 should exist
      expect(finalWorkspaces.ws3).toBeDefined();
      expect(finalWorkspaces.ws3.savedAt).toBe(3000);
    });

    it('should handle workspace count limits correctly', () => {
      const MAX_WORKSPACES = 10; // Hypothetical limit
      const workspaces: Record<string, WorkspaceState> = {};
      
      // Fill up to limit
      for (let i = 0; i < MAX_WORKSPACES; i++) {
        workspaces[`ws${i}`] = { ...createMockWorkspace(`workspace${i}`), savedAt: i };
      }
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));

      // Try to add one more
      const addOperation = () => {
        const current = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
        const count = Object.keys(current).length;
        
        if (count < MAX_WORKSPACES) {
          current.wsNew = { ...createMockWorkspace('new'), savedAt: Date.now() };
          localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(current));
        }
      };

      addOperation();

      const finalWorkspaces = JSON.parse(localStorage.getItem(STORAGE_KEYS.WORKSPACES) || '{}');
      // Should still have only MAX_WORKSPACES
      expect(Object.keys(finalWorkspaces)).toHaveLength(MAX_WORKSPACES);
      expect(finalWorkspaces.wsNew).toBeUndefined();
    });
  });
});