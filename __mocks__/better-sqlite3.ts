// Mock for better-sqlite3 to allow testing database implementation
// without requiring Electron main process

interface RunResult {
  lastInsertRowid: number | bigint;
  changes: number;
}

interface WorkspaceRow {
  id: number;
  name: string;
  folder_path: string;
  state: string | Record<string, unknown>;
  created_at: number;
  updated_at: number;
  last_accessed: number;
}

interface PreferenceRow {
  key: string;
  value: string;
}

interface CountResult {
  count: number;
}

interface NameResult {
  name: string;
}

interface ValueResult {
  value: string;
}

type BindParameters = Record<string, string | number | null | Buffer>;

interface MockStatement {
  run: jest.Mock<RunResult, [BindParameters?]>;
  get: jest.Mock<WorkspaceRow | PreferenceRow | CountResult | NameResult | ValueResult | undefined, [BindParameters?]>;
  all: jest.Mock<WorkspaceRow[] | NameResult[], [BindParameters?]>;
  pluck: jest.Mock<MockStatement, []>;
  iterate: jest.Mock<IterableIterator<unknown>, [BindParameters?]>;
  bind: jest.Mock<MockStatement, [BindParameters?]>;
  columns: jest.Mock<Array<{ name: string; type: string | null }>, []>;
  safeIntegers: jest.Mock<MockStatement, []>;
  raw: jest.Mock<MockStatement, []>;
}

type TransactionFunction<T = unknown> = (...args: unknown[]) => T;

interface MockTransaction<T = unknown> {
  (...args: Parameters<TransactionFunction<T>>): T;
  default: (...args: Parameters<TransactionFunction<T>>) => T;
  deferred: (...args: Parameters<TransactionFunction<T>>) => T;
  immediate: (...args: Parameters<TransactionFunction<T>>) => T;
  exclusive: (...args: Parameters<TransactionFunction<T>>) => T;
}

type PragmaValue = string | number | boolean;

class MockDatabase {
  private statements: Map<string, MockStatement> = new Map();
  private pragmas: Map<string, PragmaValue> = new Map();
  private _inTransaction = false;
  private mockData: Map<string, WorkspaceRow[] | PreferenceRow[]> = new Map();
  
  constructor(filename: string, options?: Record<string, unknown>) {
    // Initialize with default pragmas
    this.pragmas.set('journal_mode', 'wal');
    this.pragmas.set('synchronous', 1);
    this.pragmas.set('temp_store', 2);
    this.pragmas.set('mmap_size', 30000000000);
    this.pragmas.set('foreign_keys', 1);
    
    // Initialize mock data storage with proper types
    this.mockData.set('workspaces', [] as WorkspaceRow[]);
    this.mockData.set('preferences', [] as PreferenceRow[]);
    this.mockData.set('instructions', [] as WorkspaceRow[]);
  }
  
  prepare(sql: string): MockStatement {
    // Return cached statement or create new one
    if (!this.statements.has(sql)) {
      const statement: MockStatement = {
        run: jest.fn().mockImplementation((params?: BindParameters): RunResult => {
          // Simulate database operations
          if (sql.includes('INSERT INTO workspaces')) {
            const workspace: WorkspaceRow = {
              id: Date.now(),
              name: String(params?.name || params?.['$name'] || ''),
              folder_path: String(params?.folder_path || params?.['$folder_path'] || ''),
              state: params?.state || params?.['$state'] || {},
              created_at: Date.now(),
              updated_at: Date.now(),
              last_accessed: Date.now()
            };
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            workspaces.push(workspace);
            return { lastInsertRowid: workspace.id, changes: 1 };
          }
          
          if (sql.includes('UPDATE workspaces')) {
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            const index = workspaces.findIndex(w => 
              w.id === Number(params?.id || params?.['$id'] || 0) || 
              w.name === String(params?.name || params?.['$name'] || '')
            );
            if (index >= 0) {
              workspaces[index] = {
                ...workspaces[index],
                state: params?.state || params?.['$state'] || workspaces[index].state,
                updated_at: Date.now()
              };
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          
          if (sql.includes('DELETE FROM workspaces')) {
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            const before = workspaces.length;
            const id = Number(params?.id || params?.['$id'] || 0);
            const name = String(params?.name || params?.['$name'] || '');
            const filtered = workspaces.filter(w => 
              w.id !== id && w.name !== name
            );
            this.mockData.set('workspaces', filtered);
            const after = (this.mockData.get('workspaces') as WorkspaceRow[]).length;
            return { changes: before - after };
          }
          
          if (sql.includes('INSERT OR REPLACE INTO preferences')) {
            const prefs = this.mockData.get('preferences') as PreferenceRow[];
            const key = String(params?.key || params?.['$key'] || '');
            const existing = prefs.findIndex(p => p.key === key);
            const pref: PreferenceRow = {
              key,
              value: String(params?.value || params?.['$value'] || '')
            };
            if (existing >= 0) {
              prefs[existing] = pref;
            } else {
              prefs.push(pref);
            }
            return { changes: 1 };
          }
          
          return { lastInsertRowid: 1, changes: 1 };
        }),
        
        get: jest.fn().mockImplementation((params?: BindParameters): WorkspaceRow | PreferenceRow | CountResult | NameResult | ValueResult | undefined => {
          if (sql.includes('SELECT COUNT(*)')) {
            const table = sql.match(/FROM (\w+)/)?.[1];
            if (!table) return { count: 0 };
            const data = this.mockData.get(table);
            return { count: data?.length || 0 } as CountResult;
          }
          
          if (sql.includes('SELECT * FROM workspaces')) {
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            const id = params?.id ? Number(params.id) : params?.['$id'] ? Number(params['$id']) : undefined;
            const name = params?.name ? String(params.name) : params?.['$name'] ? String(params['$name']) : undefined;
            
            if (id) {
              return workspaces.find(w => w.id === id);
            }
            if (name) {
              return workspaces.find(w => w.name === name);
            }
            return workspaces[0];
          }
          
          if (sql.includes('SELECT value FROM preferences')) {
            const prefs = this.mockData.get('preferences') as PreferenceRow[];
            const key = params?.key ? String(params.key) : params?.['$key'] ? String(params['$key']) : undefined;
            if (!key) return undefined;
            const pref = prefs.find(p => p.key === key);
            return pref ? { value: pref.value } as ValueResult : undefined;
          }
          
          if (sql.includes('SELECT name FROM workspaces')) {
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            const name = params?.name ? String(params.name) : params?.['$name'] ? String(params['$name']) : undefined;
            if (!name) return undefined;
            return workspaces.find(w => w.name === name) ? { name } as NameResult : undefined;
          }
          
          return undefined;
        }),
        
        all: jest.fn().mockImplementation((): WorkspaceRow[] | NameResult[] => {
          if (sql.includes('SELECT * FROM workspaces')) {
            return this.mockData.get('workspaces') as WorkspaceRow[];
          }
          if (sql.includes('SELECT name FROM workspaces')) {
            const workspaces = this.mockData.get('workspaces') as WorkspaceRow[];
            return workspaces.map(w => ({ name: w.name })) as NameResult[];
          }
          return [];
        }),
        
        pluck: jest.fn().mockReturnThis(),
        iterate: jest.fn(),
        bind: jest.fn().mockReturnThis(),
        columns: jest.fn().mockReturnValue([]),
        safeIntegers: jest.fn().mockReturnThis(),
        raw: jest.fn().mockReturnThis()
      };
      
      this.statements.set(sql, statement);
    }
    
    return this.statements.get(sql)!;
  }
  
  exec(sql: string): this {
    // Simulate table creation
    return this;
  }
  
  pragma(key: string, value?: PragmaValue | { simple: boolean }): PragmaValue | undefined {
    if (value !== undefined) {
      if (typeof value === 'object' && 'simple' in value) {
        // Just requesting the value with simple flag
        return this.pragmas.get(key);
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        this.pragmas.set(key, value);
        return undefined;
      }
    }
    
    return this.pragmas.get(key);
  }
  
  transaction<T = unknown>(fn: TransactionFunction<T>): MockTransaction<T> {
    const executeTransaction = (...args: Parameters<TransactionFunction<T>>): T => {
      this._inTransaction = true;
      try {
        const result = fn(...args);
        this._inTransaction = false;
        return result;
      } catch (error) {
        this._inTransaction = false;
        throw error;
      }
    };
    
    const transaction = executeTransaction as MockTransaction<T>;
    transaction.default = executeTransaction;
    transaction.deferred = executeTransaction;
    transaction.immediate = executeTransaction;
    transaction.exclusive = executeTransaction;
    
    return transaction;
  }
  
  close(): void {
    // Mock close operation
  }
  
  get inTransaction(): boolean {
    return this._inTransaction;
  }
}

export default MockDatabase;