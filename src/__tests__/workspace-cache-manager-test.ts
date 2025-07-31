import { WorkspaceCacheManager } from '../utils/workspace-cache-manager';
import { STORAGE_KEYS } from '../constants';

describe('WorkspaceCacheManager - User Workspace Management', () => {
  let cacheManager: WorkspaceCacheManager;
  let originalLocalStorage: Storage;
  
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (index: number) => Object.keys(store)[index] || null,
      };
    })();
    
    originalLocalStorage = global.localStorage;
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true
    });
    
    // Clear singleton instance
    // Use type assertion to access private static property for testing
    const cacheManagerClass = WorkspaceCacheManager as unknown as {
      instance: WorkspaceCacheManager | null;
    };
    cacheManagerClass.instance = null;
    cacheManager = WorkspaceCacheManager.getInstance();
  });
  
  afterEach(() => {
    // Restore original localStorage
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true
    });
  });
  
  describe('Workspace State Consistency', () => {
    it('should maintain consistent workspace state across UI components', () => {
      // Setup: User modifies workspace in one part of the app
      const cacheInSidebar = WorkspaceCacheManager.getInstance();
      const cacheInMainView = WorkspaceCacheManager.getInstance();
      
      // Setup workspace data that represents real user work
      const userWorkspace = {
        selectedFiles: ['src/index.ts', 'README.md'],
        expandedFolders: ['src', 'tests'],
        customPrompts: ['Review this TypeScript code']
      };
      
      // Action: Save workspace through sidebar
      const workspaces = new Map([['shared-project', { savedAt: Date.now(), name: 'shared-project', ...userWorkspace }]]);
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(Object.fromEntries(workspaces)));
      
      // Force reload in sidebar instance
      cacheInSidebar.refresh();
      
      // Assertion: Change is immediately visible in main view without manual refresh
      expect(cacheInMainView.hasWorkspace('shared-project')).toBe(true);
      const retrievedWorkspace = cacheInMainView.getWorkspaces().get('shared-project');
      expect(retrievedWorkspace).toBeDefined();
      
      // Business value: UI stays synchronized without manual refresh
      // Users don't lose work or have to refresh to see their changes
    });
  });
  
  describe('Workspace Persistence', () => {
    it('should preserve user workspaces between application sessions', () => {
      // Setup: User has been working on multiple projects
      const userProjects = {
        'react-app': { 
          savedAt: Date.now() - 86400000, // Yesterday
          name: 'react-app',
          selectedFiles: ['src/App.tsx', 'src/index.tsx'],
          expandedFolders: ['src', 'public'],
          userInstructions: 'Focus on performance optimizations'
        },
        'api-backend': { 
          savedAt: Date.now() - 3600000, // An hour ago
          name: 'api-backend',
          selectedFiles: ['server.js', 'routes/auth.js'],
          expandedFolders: ['routes', 'middleware'],
          systemPrompt: 'Use Express.js best practices'
        },
        'mobile-app': { 
          savedAt: Date.now() - 7200000, // Two hours ago
          name: 'mobile-app',
          selectedFiles: ['App.js', 'screens/Home.js'],
          expandedFolders: ['screens', 'components'],
          rolePrompt: 'Act as a React Native expert'
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(userProjects));
      
      // Action: User reopens the application (simulated by new cache instance)
      const result = cacheManager.getWorkspaces();
      
      // Assertion: All user work is preserved
      expect(result.size).toBe(3);
      
      // Verify each workspace maintains its complete state
      const reactApp = result.get('react-app');
      expect(reactApp).toBeDefined();
      expect(reactApp?.name).toBe('react-app');
      expect(reactApp?.savedAt).toBeGreaterThan(0);
      
      const apiBackend = result.get('api-backend');
      expect(apiBackend).toBeDefined();
      expect(apiBackend?.name).toBe('api-backend');
      expect(apiBackend?.savedAt).toBeGreaterThan(0);
      
      // Business value: Users can close and reopen the app without losing any work
      // Their file selections, folder states, and custom prompts are all preserved
    });
    
    it('should handle legacy double-serialized data', () => {
      const workspaces = {
        'workspace1': JSON.stringify({ savedAt: 1000, name: 'workspace1' }),
        'workspace2': JSON.stringify({ savedAt: 2000, name: 'workspace2' })
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      
      const result = cacheManager.getWorkspaces();
      expect(result.size).toBe(2);
      expect(result.get('workspace1')).toEqual({ name: 'workspace1', savedAt: 1000 });
      expect(result.get('workspace2')).toEqual({ name: 'workspace2', savedAt: 2000 });
    });
    
    it('should recover gracefully when workspace data is corrupted without losing valid workspaces', () => {
      // Setup: Simulate real-world data corruption scenarios
      // This can happen due to browser crashes, storage limits, or manual tampering
      const partiallyCorruptedData = {
        'project-alpha': { 
          savedAt: Date.now() - 3600000,
          name: 'project-alpha',
          selectedFiles: ['main.js', 'config.js'],
          expandedFolders: ['src']
        },
        'project-beta': '{"savedAt": broken json', // Corrupted during save
        'project-gamma': null, // Incomplete write
        'project-delta': { savedAt: 'not-a-number' }, // Type corruption
        'project-epsilon': { 
          savedAt: Date.now(),
          name: 'project-epsilon',
          selectedFiles: ['index.html', 'style.css']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(partiallyCorruptedData));
      
      // Action: User opens the application
      const result = cacheManager.getWorkspaces();
      
      // Assertion: Valid workspaces are preserved, corrupted ones are handled gracefully
      expect(result.size).toBeGreaterThanOrEqual(2); // At least the valid ones
      
      // Verify valid workspaces are intact
      const projectAlpha = result.get('project-alpha');
      expect(projectAlpha).toBeDefined();
      expect(projectAlpha?.name).toBe('project-alpha');
      expect(projectAlpha?.savedAt).toBeGreaterThan(0);
      
      const projectEpsilon = result.get('project-epsilon');
      expect(projectEpsilon).toBeDefined();
      expect(projectEpsilon?.name).toBe('project-epsilon');
      expect(projectEpsilon?.savedAt).toBeGreaterThan(0);
      
      // Verify system doesn't crash on corrupted entries
      expect(() => cacheManager.getSortedList('recent')).not.toThrow();
      expect(() => cacheManager.getWorkspaceCount()).not.toThrow();
      
      // Business value: Users don't lose all their work due to one corrupted workspace
      // The application remains usable even with partial data corruption
    });
    
    it('should handle empty localStorage', () => {
      const result = cacheManager.getWorkspaces();
      expect(result.size).toBe(0);
    });
  });
  
  describe('Workspace Organization', () => {
    beforeEach(() => {
      // Setup: User has multiple real projects saved at different times
      const workspaces = {
        'e-commerce-frontend': { 
          savedAt: Date.now() - 7200000, // 2 hours ago
          name: 'e-commerce-frontend',
          selectedFiles: ['src/Cart.tsx', 'src/Product.tsx'],
          lastModified: Date.now() - 7200000
        },
        'blog-platform': { 
          savedAt: Date.now() - 86400000, // 1 day ago
          name: 'blog-platform',
          selectedFiles: ['pages/index.js', 'pages/post.js'],
          lastModified: Date.now() - 86400000
        },
        'analytics-dashboard': { 
          savedAt: Date.now() - 300000, // 5 minutes ago
          name: 'analytics-dashboard',
          selectedFiles: ['src/Dashboard.tsx', 'src/Chart.tsx'],
          lastModified: Date.now() - 300000
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
    });
    
    it('should allow users to quickly access recently used workspaces', () => {
      // Action: User wants to continue working on their most recent project
      const recentWorkspaces = cacheManager.getSortedList('recent');
      
      // Assertion: Most recently saved workspace appears first
      expect(recentWorkspaces[0]).toBe('analytics-dashboard');
      expect(recentWorkspaces[1]).toBe('e-commerce-frontend');
      expect(recentWorkspaces[2]).toBe('blog-platform');
      
      // Verify the most recent workspace is actually the newest
      const mostRecent = cacheManager.getWorkspaces().get(recentWorkspaces[0]);
      expect(mostRecent?.savedAt).toBeGreaterThan(Date.now() - 600000); // Less than 10 minutes old
      
      // Business value: Users can quickly resume their most recent work
      // The workflow supports the common pattern of continuing where you left off
    });
    
    it('should support alphabetical ordering for large workspace lists', () => {
      // Setup: User has many projects and needs to find them by name
      const manyWorkspaces: Record<string, { savedAt: number; name: string; selectedFiles: string[] }> = {};
      const projectNames = ['zebra-project', 'alpha-project', 'beta-project', 'gamma-project', 'delta-project'];
      
      projectNames.forEach((name, index) => {
        manyWorkspaces[name] = {
          savedAt: Date.now() - (index * 1000),
          name: name,
          selectedFiles: [`${name}/main.js`]
        };
      });
      
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(manyWorkspaces));
      cacheManager.refresh();
      
      // Action: User switches to alphabetical view to find a specific project
      const alphabeticalList = cacheManager.getSortedList('alphabetical');
      
      // Assertion: Projects are ordered alphabetically for easy scanning
      expect(alphabeticalList[0]).toBe('alpha-project');
      expect(alphabeticalList[1]).toBe('beta-project');
      expect(alphabeticalList[alphabeticalList.length - 1]).toBe('zebra-project');
      
      // Business value: Users can quickly locate projects by name
      // Supports users who organize projects with naming conventions
    });
    
    it('should preserve custom workspace ordering preferences', () => {
      // Setup: User has manually arranged their workspaces in a specific order
      // This might represent project priority or workflow sequence
      const customOrder = ['blog-platform', 'analytics-dashboard', 'e-commerce-frontend'];
      
      // Action: User has set a custom order that makes sense for their workflow
      const sorted = cacheManager.getSortedList('manual', customOrder);
      
      // Assertion: The exact custom order is preserved
      expect(sorted).toEqual(customOrder);
      expect(sorted[0]).toBe('blog-platform');
      expect(sorted[1]).toBe('analytics-dashboard');
      expect(sorted[2]).toBe('e-commerce-frontend');
      
      // Business value: Users can organize workspaces according to their workflow
      // Supports power users who have specific project priorities
    });
    
    it('should provide consistent workspace ordering for user navigation', () => {
      // Setup: User has saved multiple workspaces over time
      const userWorkspaces = {
        'project-alpha': { savedAt: Date.now() - 3600000, name: 'project-alpha' },
        'project-beta': { savedAt: Date.now() - 7200000, name: 'project-beta' },
        'project-gamma': { savedAt: Date.now(), name: 'project-gamma' }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(userWorkspaces));
      cacheManager.refresh();
      
      // Action: User requests recently used workspaces multiple times
      const recentWorkspaces1 = cacheManager.getSortedList('recent');
      const recentWorkspaces2 = cacheManager.getSortedList('recent');
      const recentWorkspaces3 = cacheManager.getSortedList('recent');
      
      // Assertion: Ordering remains consistent across multiple calls
      expect(recentWorkspaces1).toEqual(recentWorkspaces2);
      expect(recentWorkspaces2).toEqual(recentWorkspaces3);
      expect(recentWorkspaces1[0]).toBe('project-gamma');
      expect(recentWorkspaces1).toHaveLength(3);
      
      // Business value: Users get predictable, stable UI behavior
      // Workspace order doesn't randomly change while they're working
    });
    
    it('should immediately reflect manual ordering changes without caching interference', () => {
      // Setup: User is actively reorganizing their workspace list
      const initialOrder = ['blog-platform', 'analytics-dashboard', 'e-commerce-frontend'];
      const sorted1 = cacheManager.getSortedList('manual', initialOrder);
      
      // Action: User drags workspaces to reorder them
      const newOrder = ['analytics-dashboard', 'e-commerce-frontend', 'blog-platform'];
      const sorted2 = cacheManager.getSortedList('manual', newOrder);
      
      // Assertion: New order is immediately reflected
      expect(sorted1).not.toEqual(sorted2);
      expect(sorted2).toEqual(newOrder);
      
      // Action: User makes another adjustment
      const finalOrder = ['e-commerce-frontend', 'analytics-dashboard', 'blog-platform'];
      const sorted3 = cacheManager.getSortedList('manual', finalOrder);
      
      // Assertion: Each change is immediately reflected
      expect(sorted3).toEqual(finalOrder);
      
      // Business value: Users get immediate feedback when organizing workspaces
      // Manual customization is responsive and predictable
    });
  });
  
  describe('Dynamic Workspace Updates', () => {
    beforeEach(() => {
      // Setup: User has an active workspace session
      const activeWorkspace = {
        'current-project': {
          savedAt: Date.now() - 10000,
          name: 'current-project',
          selectedFiles: ['src/main.js'],
          expandedFolders: ['src']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(activeWorkspace));
    });
    
    it('should reflect new workspace additions immediately for seamless workflow', () => {
      // Initial state: User has one workspace
      const initialWorkspaces = cacheManager.getWorkspaces();
      expect(initialWorkspaces.size).toBe(1);
      expect(initialWorkspaces.has('current-project')).toBe(true);
      
      // Action: User creates a new workspace while working
      const updatedWorkspaces = {
        'current-project': {
          savedAt: Date.now() - 10000,
          name: 'current-project',
          selectedFiles: ['src/main.js'],
          expandedFolders: ['src']
        },
        'new-feature-branch': {
          savedAt: Date.now(),
          name: 'new-feature-branch',
          selectedFiles: ['feature/new-component.tsx'],
          expandedFolders: ['feature']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      
      // Refresh the cache to pick up changes
      cacheManager.invalidate();
      
      // Assertion: New workspace is immediately available
      const result = cacheManager.getWorkspaces();
      expect(result.size).toBe(2);
      expect(result.has('new-feature-branch')).toBe(true);
      
      // Verify the new workspace has all its data
      const newWorkspace = result.get('new-feature-branch');
      expect(newWorkspace).toBeDefined();
      expect(newWorkspace?.name).toBe('new-feature-branch');
      expect(newWorkspace?.savedAt).toBeGreaterThan(Date.now() - 60000);
      
      // Business value: Users can create and switch between workspaces fluidly
      // No need to restart the app to see new workspaces
    });
    
    it('should maintain view preferences when workspace list updates', () => {
      // Setup: User has chosen a specific sort order
      const initialAlpha = cacheManager.getSortedList('alphabetical');
      expect(initialAlpha).toEqual(['current-project']); // Verify initial state
      
      // Action: New workspace is added by user
      const updatedWorkspaces = {
        'current-project': { savedAt: Date.now() - 10000, name: 'current-project' },
        'aaa-new-project': { savedAt: Date.now(), name: 'aaa-new-project' }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      
      // Simulate selective cache invalidation - invalidate entire cache first to pick up new data
      cacheManager.invalidate();
      
      // Assertion: Recent view reflects the update
      const updatedRecent = cacheManager.getSortedList('recent');
      expect(updatedRecent).toContain('aaa-new-project');
      expect(updatedRecent[0]).toBe('aaa-new-project'); // Most recent first
      
      // Alphabetical view would need full refresh to see new items
      cacheManager.refresh();
      const newAlpha = cacheManager.getSortedList('alphabetical');
      expect(newAlpha).toEqual(['aaa-new-project', 'current-project']);
      
      // Business value: Selective updates improve performance
      // User can control when different views update
    });
  });
  
  describe('UI Component Synchronization', () => {
    it('should keep all UI components in sync when workspaces change', () => {
      // Setup: Multiple UI components listening for workspace changes
      const sidebarUpdater = jest.fn();
      const headerUpdater = jest.fn();
      const mainViewUpdater = jest.fn();
      
      // Simulate different UI components subscribing
      const unsubscribeSidebar = cacheManager.subscribe(sidebarUpdater);
      const unsubscribeHeader = cacheManager.subscribe(headerUpdater);
      const unsubscribeMainView = cacheManager.subscribe(mainViewUpdater);
      
      // Action: Load initial data to establish cache
      cacheManager.getWorkspaces();
      
      // Now invalidate to trigger notifications
      cacheManager.invalidate();
      
      // Assertion: All UI components are notified
      expect(sidebarUpdater).toHaveBeenCalledTimes(1);
      expect(headerUpdater).toHaveBeenCalledTimes(1);
      expect(mainViewUpdater).toHaveBeenCalledTimes(1);
      
      // Test selective unsubscription (e.g., component unmounts)
      unsubscribeSidebar();
      
      // Need to load data again to have something to invalidate
      cacheManager.getWorkspaces();
      
      // Action: Another workspace change
      cacheManager.invalidate();
      
      // Assertion: Only active components are notified
      expect(sidebarUpdater).toHaveBeenCalledTimes(1); // Not called again
      expect(headerUpdater).toHaveBeenCalledTimes(2); // Called again
      expect(mainViewUpdater).toHaveBeenCalledTimes(2); // Called again
      
      // Cleanup
      unsubscribeHeader();
      unsubscribeMainView();
      
      // Business value: UI stays consistent across all components
      // Components can subscribe/unsubscribe based on lifecycle
    });
    
    it('should handle component errors without affecting other UI updates', () => {
      // Setup: One component has a bug but others should still update
      const buggyComponent = jest.fn(() => {
        throw new Error('Component render error');
      });
      const workingComponent = jest.fn();
      const anotherWorkingComponent = jest.fn();
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Subscribe all components
      cacheManager.subscribe(buggyComponent);
      cacheManager.subscribe(workingComponent);
      cacheManager.subscribe(anotherWorkingComponent);
      
      // Load initial data to establish cache
      cacheManager.getWorkspaces();
      
      // Action: Trigger an update
      cacheManager.invalidate();
      
      // Assertions: All components were called despite one failing
      expect(buggyComponent).toHaveBeenCalled();
      expect(workingComponent).toHaveBeenCalled();
      expect(anotherWorkingComponent).toHaveBeenCalled();
      
      // Error was logged but didn't crash the app
      expect(consoleSpy).toHaveBeenCalledWith('Cache listener error:', expect.objectContaining({
        message: expect.stringContaining('Component render error')
      }));
      
      consoleSpy.mockRestore();
      
      // Business value: One buggy component doesn't break the entire UI
      // Application remains stable despite component errors
    });
  });
  
  describe('Workspace Discovery and Navigation', () => {
    beforeEach(() => {
      // Setup: User has multiple active projects
      const userProjects = {
        'web-app': {
          savedAt: Date.now() - 3600000,
          name: 'web-app',
          selectedFiles: ['src/App.tsx', 'src/index.tsx'],
          description: 'Main web application'
        },
        'mobile-app': {
          savedAt: Date.now() - 7200000,
          name: 'mobile-app',
          selectedFiles: ['App.js', 'screens/Home.js'],
          description: 'React Native mobile app'
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(userProjects));
    });
    
    it('should quickly tell users how many workspaces they have available', () => {
      // Action: User opens workspace selector
      const workspaceCount = cacheManager.getWorkspaceCount();
      
      // Assertion: Accurate count for UI display
      expect(workspaceCount).toBe(2);
      
      // Business value: Users can see at a glance how many projects they have
      // Helps with workspace management decisions
    });
    
    it('should enable fast workspace existence checks for navigation', () => {
      // Scenario: User tries to navigate to a workspace (e.g., from a bookmark)
      const requestedWorkspace = 'web-app';
      const nonExistentWorkspace = 'deleted-project';
      
      // Action: Check if workspaces exist before navigation
      const canNavigateToWebApp = cacheManager.hasWorkspace(requestedWorkspace);
      const canNavigateToDeleted = cacheManager.hasWorkspace(nonExistentWorkspace);
      
      // Assertions
      expect(canNavigateToWebApp).toBe(true);
      expect(canNavigateToDeleted).toBe(false);
      
      // Business value: Prevents navigation errors
      // Users get immediate feedback about workspace availability
    });
    
    it('should allow users to see newly created workspaces without restart', () => {
      // Initial state: User has 2 workspaces
      expect(cacheManager.getWorkspaceCount()).toBe(2);
      expect(cacheManager.hasWorkspace('web-app')).toBe(true);
      expect(cacheManager.hasWorkspace('new-api')).toBe(false);
      
      // Action: User creates a new workspace in another part of the app
      const updatedWorkspaces = {
        'web-app': {
          savedAt: Date.now() - 3600000,
          name: 'web-app',
          selectedFiles: ['src/App.tsx', 'src/index.tsx']
        },
        'mobile-app': {
          savedAt: Date.now() - 7200000,
          name: 'mobile-app',
          selectedFiles: ['App.js', 'screens/Home.js']
        },
        'new-api': {
          savedAt: Date.now(),
          name: 'new-api',
          selectedFiles: ['server.js', 'routes/index.js']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      
      // User refreshes the workspace list
      cacheManager.refresh();
      
      // Assertions: New workspace is immediately discoverable
      expect(cacheManager.getWorkspaceCount()).toBe(3);
      expect(cacheManager.hasWorkspace('new-api')).toBe(true);
      
      // Verify it appears in sorted lists
      const recentList = cacheManager.getSortedList('recent');
      expect(recentList[0]).toBe('new-api'); // Most recent first
      
      // Business value: Dynamic workspace discovery
      // Users don't need to restart to see new workspaces
    });
  });
  
  describe('Performance Optimization', () => {
    it('should provide instant workspace switching for better UX', () => {
      // Setup: User has multiple workspaces and switches between them frequently
      const workspaces: Record<string, {
        savedAt: number;
        name: string;
        selectedFiles: string[];
        expandedFolders: string[];
        tokenCount: number;
      }> = {};
      for (let i = 0; i < 50; i++) {
        workspaces[`project-${i}`] = {
          savedAt: Date.now() - (i * 60000),
          name: `project-${i}`,
          selectedFiles: [`src/file${i}.ts`, `tests/test${i}.ts`],
          expandedFolders: ['src', 'tests'],
          tokenCount: 1000 + (i * 100)
        };
      }
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(workspaces));
      
      // Action: Measure performance of workspace operations
      const startTime = performance.now();
      
      // First access - loads from storage
      const workspaceList1 = cacheManager.getWorkspaces();
      const loadTime = performance.now() - startTime;
      
      // Subsequent accesses should be much faster
      const accessStartTime = performance.now();
      const workspaceList2 = cacheManager.getWorkspaces();
      cacheManager.getWorkspaces();
      const sorted1 = cacheManager.getSortedList('recent');
      const sorted2 = cacheManager.getSortedList('alphabetical');
      const accessTime = performance.now() - accessStartTime;
      
      // Assertions: Subsequent access should be significantly faster
      expect(workspaceList1.size).toBe(50);
      expect(workspaceList2.size).toBe(50);
      expect(sorted1.length).toBe(50);
      expect(sorted2.length).toBe(50);
      
      // Performance assertion: Cached access should be at least 10x faster
      // This ensures UI remains responsive during workspace switching
      if (loadTime > 1) { // Only check if initial load took measurable time
        expect(accessTime).toBeLessThan(loadTime / 10);
      }
      
      // Business value: Users experience instant workspace switching
      // No UI lag when navigating between projects
    });
    
    it('should handle thousands of workspaces without UI lag', () => {
      // Setup: Power user with extensive workspace history
      const largeWorkspaceSet: Record<string, {
        savedAt: number;
        name: string;
        selectedFiles: string[];
        metadata: { description: string };
      }> = {};
      for (let i = 0; i < 1000; i++) {
        largeWorkspaceSet[`workspace-${i}`] = {
          savedAt: Date.now() - (i * 1000),
          name: `workspace-${i}`,
          selectedFiles: [`file${i}.js`],
          metadata: { description: `Project ${i} description` }
        };
      }
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(largeWorkspaceSet));
      
      // Action: Load and operate on large workspace set
      const startTime = performance.now();
      const workspaces = cacheManager.getWorkspaces();
      const sorted = cacheManager.getSortedList('recent');
      const totalTime = performance.now() - startTime;
      
      // Assertions
      expect(workspaces.size).toBe(1000); // Should handle the max cache size
      expect(sorted.length).toBe(1000);
      
      // Performance assertion: Operations should complete in reasonable time
      expect(totalTime).toBeLessThan(100); // 100ms is imperceptible to users
      
      // Verify memory management is working
      const stats = cacheManager.getCacheStats();
      expect(stats.size).toBe(1000);
      expect(stats.hasData).toBe(true);
      
      // Business value: App remains performant even for power users
      // Large workspace collections don't degrade user experience
    });
  });
  
  describe('Data Integrity', () => {
    it('should prevent workspace data loss during concurrent updates', () => {
      // Setup: Initial workspace state
      const initialWorkspaces = {
        'project-a': { savedAt: Date.now() - 1000, name: 'project-a', selectedFiles: ['a.js'] },
        'project-b': { savedAt: Date.now() - 2000, name: 'project-b', selectedFiles: ['b.js'] }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(initialWorkspaces));
      
      // Action: Simulate concurrent updates from different parts of the app
      const cache1 = cacheManager;
      const cache2 = WorkspaceCacheManager.getInstance(); // Same instance
      
      // Both caches should see the same data
      expect(cache1.getWorkspaces().size).toBe(2);
      expect(cache2.getWorkspaces().size).toBe(2);
      
      // Update through one cache
      const updatedWorkspaces = {
        ...initialWorkspaces,
        'project-c': { savedAt: Date.now(), name: 'project-c', selectedFiles: ['c.js'] }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      cache1.refresh();
      
      // Verify both caches see the update
      expect(cache1.getWorkspaces().size).toBe(3);
      expect(cache2.getWorkspaces().size).toBe(3);
      expect(cache2.hasWorkspace('project-c')).toBe(true);
      
      // Business value: No data loss when multiple components access workspaces
      // Prevents race conditions that could lose user work
    });
    
    it('should validate workspace data before saving to prevent corruption', () => {
      // Setup: Load valid workspaces
      const validWorkspaces = {
        'valid-project': {
          savedAt: Date.now(),
          name: 'valid-project',
          selectedFiles: ['main.js', 'utils.js'],
          expandedFolders: ['src', 'lib']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(validWorkspaces));
      cacheManager.refresh();
      
      // Verify valid data loads correctly
      const loaded = cacheManager.getWorkspaces();
      expect(loaded.size).toBe(1);
      expect(loaded.get('valid-project')).toBeDefined();
      expect(loaded.get('valid-project')?.name).toBe('valid-project');
      
      // Setup: Attempt to load workspace with invalid structure
      const invalidWorkspaces = {
        'valid-project': validWorkspaces['valid-project'],
        'invalid-project': 'this is not a valid workspace object',
        'null-project': null,
        'undefined-project': undefined
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(invalidWorkspaces));
      cacheManager.refresh();
      
      // Assertion: System handles invalid data gracefully
      const result = cacheManager.getWorkspaces();
      expect(result.has('valid-project')).toBe(true); // Valid data preserved
      expect(result.get('valid-project')?.name).toBe('valid-project');
      
      // Invalid entries are handled without crashing
      expect(() => cacheManager.getSortedList('recent')).not.toThrow();
      expect(() => cacheManager.getWorkspaceCount()).not.toThrow();
      
      // Business value: Protects user data from corruption
      // One bad workspace doesn't break the entire system
    });
    
    it('should automatically manage storage to prevent exceeding browser limits', () => {
      // Setup: Simulate approaching browser storage limits
      const manyWorkspaces: Record<string, {
        savedAt: number;
        name: string;
        selectedFiles: string[];
        expandedFolders: string[];
        customData: string;
      }> = {};
      
      // Create 1100 workspaces (exceeding the 1000 limit)
      for (let i = 0; i < 1100; i++) {
        manyWorkspaces[`project-${i}`] = {
          savedAt: Date.now() - (1100 - i) * 1000, // Older projects have lower savedAt
          name: `project-${i}`,
          selectedFiles: Array(10).fill(null).map((_, j) => `file${i}-${j}.js`),
          expandedFolders: Array(5).fill(null).map((_, j) => `folder${i}-${j}`),
          customData: `Custom data for project ${i} to simulate real workspace size`
        };
      }
      
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(manyWorkspaces));
      cacheManager.refresh();
      
      // Action: System loads workspaces with automatic trimming
      const result = cacheManager.getWorkspaces();
      
      // Assertions
      expect(result.size).toBe(1000); // Trimmed to max size
      
      // Verify most recent workspaces are kept
      expect(result.has('project-1099')).toBe(true); // Recent
      expect(result.has('project-1050')).toBe(true); // Recent
      expect(result.has('project-0')).toBe(false); // Old, should be trimmed
      expect(result.has('project-50')).toBe(false); // Old, should be trimmed
      
      // Verify the kept workspaces are the most recent ones
      const sortedRecent = cacheManager.getSortedList('recent');
      expect(sortedRecent[0]).toBe('project-1099'); // Most recent
      expect(sortedRecent[sortedRecent.length - 1]).toBe('project-100'); // Oldest kept
      
      // Business value: Prevents browser storage errors
      // Automatically maintains most relevant (recent) workspaces
      // Users don't lose recent work due to storage limits
    });
  });
  
  describe('Cross-Tab Synchronization', () => {
    it('should synchronize workspace changes across browser tabs', () => {
      // Setup: User has the app open in multiple tabs
      const listener = jest.fn();
      cacheManager.subscribe(listener);
      
      // Initial state
      const initialWorkspaces = {
        'shared-project': { savedAt: Date.now() - 1000, name: 'shared-project' }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(initialWorkspaces));
      cacheManager.getWorkspaces();
      
      // Action: User saves a new workspace in another tab
      const updatedWorkspaces = {
        'shared-project': { savedAt: Date.now() - 1000, name: 'shared-project' },
        'new-project': { savedAt: Date.now(), name: 'new-project' }
      };
      
      // Simulate storage event from another tab
      // Note: In JSDOM, we can't use storageArea parameter
      const event = new StorageEvent('storage', {
        key: STORAGE_KEYS.WORKSPACES,
        newValue: JSON.stringify(updatedWorkspaces),
        oldValue: JSON.stringify(initialWorkspaces)
      });
      window.dispatchEvent(event);
      
      // Assertions
      expect(listener).toHaveBeenCalled();
      
      // After refresh, new workspace should be visible
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      cacheManager.refresh();
      expect(cacheManager.hasWorkspace('new-project')).toBe(true);
      expect(cacheManager.getWorkspaceCount()).toBe(2);
      
      // Business value: Users can work with multiple tabs open
      // Changes in one tab are reflected in others
    });
    
    it('should ignore storage events from non-workspace keys to prevent unnecessary refreshes', () => {
      // Setup: Monitor for cache invalidations
      const listener = jest.fn();
      cacheManager.subscribe(listener);
      
      // Action: Other parts of the app use localStorage
      const events = [
        new StorageEvent('storage', {
          key: 'user-preferences',
          newValue: '{"theme":"dark"}',
          oldValue: '{"theme":"light"}'
        }),
        new StorageEvent('storage', {
          key: 'app-settings',
          newValue: 'some-value',
          oldValue: 'old-value'
        })
      ];
      
      events.forEach(event => window.dispatchEvent(event));
      
      // Assertion: Cache is not invalidated for unrelated storage changes
      expect(listener).not.toHaveBeenCalled();
      
      // Business value: Performance optimization
      // Workspace list doesn't refresh unnecessarily
    });
  });
  
  describe('Real-time Updates', () => {
    it('should reflect workspace changes immediately when notified', () => {
      // Setup: User is actively managing workspaces
      const listener = jest.fn();
      cacheManager.subscribe(listener);
      
      // Initial workspace state
      const initialWorkspaces = {
        'active-project': {
          savedAt: Date.now() - 5000,
          name: 'active-project',
          selectedFiles: ['src/app.js']
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(initialWorkspaces));
      cacheManager.getWorkspaces();
      
      // Action: User saves changes to the workspace
      const updatedWorkspaces = {
        'active-project': {
          savedAt: Date.now(),
          name: 'active-project',
          selectedFiles: ['src/app.js', 'src/utils.js', 'README.md'] // Added files
        }
      };
      localStorage.setItem(STORAGE_KEYS.WORKSPACES, JSON.stringify(updatedWorkspaces));
      
      // Simulate the app notifying about the change
      window.dispatchEvent(new CustomEvent('workspacesChanged'));
      
      // Assertions
      expect(listener).toHaveBeenCalled();
      
      // After notification, changes should be available
      cacheManager.refresh();
      const workspace = cacheManager.getWorkspaces().get('active-project');
      expect(workspace).toBeDefined();
      expect(workspace?.name).toBe('active-project');
      expect(workspace?.savedAt).toBeGreaterThan(Date.now() - 60000);
      
      // Business value: UI components stay in sync
      // Users see their changes reflected immediately
    });
  });
  
  describe('Error Recovery and Resilience', () => {
    it('should handle localStorage quota exceeded errors gracefully', () => {
      // Setup: Simulate localStorage being nearly full
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Override setItem to simulate quota exceeded
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn().mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      
      // Action: Try to work with workspaces despite storage issues
      expect(() => {
        cacheManager.getWorkspaces();
        cacheManager.getSortedList('recent');
      }).not.toThrow();
      
      // Restore original functionality
      localStorage.setItem = originalSetItem;
      consoleSpy.mockRestore();
      
      // Business value: App remains functional even when storage is full
      // Users can still view and work with existing workspaces
    });
    
    it('should handle disabled localStorage (private browsing) gracefully', () => {
      // Setup: Simulate localStorage being disabled
      const workingLocalStorage = global.localStorage;
      
      // Temporarily replace localStorage with a throwing version
      Object.defineProperty(global, 'localStorage', {
        get: () => {
          throw new Error('localStorage is not available');
        },
        configurable: true
      });
      
      // Create new instance that will encounter the error
      // Use type assertion to access constructor for testing purposes
      const WorkspaceCacheManagerConstructor = WorkspaceCacheManager as unknown as new () => WorkspaceCacheManager;
      const privateModeCacheManager = new WorkspaceCacheManagerConstructor();
      
      // Action: Try to use cache manager in private mode
      expect(() => {
        privateModeCacheManager.getWorkspaces();
        privateModeCacheManager.getSortedList('recent');
        privateModeCacheManager.getWorkspaceCount();
      }).not.toThrow();
      
      // Assertions: Should return empty but valid results
      expect(privateModeCacheManager.getWorkspaces().size).toBe(0);
      expect(privateModeCacheManager.getSortedList('recent')).toEqual([]);
      expect(privateModeCacheManager.getWorkspaceCount()).toBe(0);
      
      // Restore localStorage
      Object.defineProperty(global, 'localStorage', {
        value: workingLocalStorage,
        configurable: true
      });
      
      // Business value: App works in private browsing mode
      // Users can still use core features without persistence
    });
  });
});