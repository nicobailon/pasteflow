export interface SystemExecutionContext {
  directory: {
    cwd: string;
    home: string;
  };
  platform: {
    os: string;
    arch: string;
    version: string;
  };
  timestamp: string; // ISO format
  shell: {
    name: string;
    version?: string;
    path?: string;
  };
}

export interface SystemExecutionContextEnvelope {
  version: 1;
  context: SystemExecutionContext;
  generatedAt: number; // Unix timestamp
}

