import { FileData } from '../types/file-types';

interface VirtualFileData {
  metadata: {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    isBinary: boolean;
    lastModified?: Date;
  };
  content?: string;
  tokenCount?: number;
  isContentLoaded: boolean;
  contentPromise?: Promise<{ content: string; tokenCount: number }>;
}

export class VirtualFileLoader {
  private fileCache = new Map<string, VirtualFileData>();
  private readonly maxCacheSize = 100 * 1024 * 1024; // 100MB
  private currentCacheSize = 0;
  private loadQueue = new Map<string, Promise<{ content: string; tokenCount: number }>>();
  
  constructor(
    private loadContentFn: (path: string) => Promise<{ content: string; tokenCount: number }>
  ) {}

  createVirtualFile(file: FileData): VirtualFileData {
    const existing = this.fileCache.get(file.path);
    if (existing) {
      return existing;
    }

    const virtualFile: VirtualFileData = {
      metadata: {
        name: file.name,
        path: file.path,
        isDirectory: file.isDirectory,
        size: file.size,
        isBinary: file.isBinary,
        lastModified: undefined
      },
      isContentLoaded: false,
      content: file.content,
      tokenCount: file.tokenCount
    };

    if (file.content) {
      virtualFile.isContentLoaded = true;
      // Use actual memory size, not disk size (UTF-16 strings use ~2x bytes)
      this.currentCacheSize += new Blob([file.content]).size;
    }

    this.fileCache.set(file.path, virtualFile);
    this.enforceMemoryLimit();
    
    return virtualFile;
  }

  async loadFileContent(path: string): Promise<VirtualFileData> {
    const virtualFile = this.fileCache.get(path);
    if (!virtualFile) {
      throw new Error(`File not found in virtual loader: ${path}`);
    }

    if (virtualFile.isContentLoaded && virtualFile.content) {
      return virtualFile;
    }

    // Check if already loading
    if (virtualFile.contentPromise) {
      const result = await virtualFile.contentPromise;
      virtualFile.content = result.content;
      virtualFile.tokenCount = result.tokenCount;
      virtualFile.isContentLoaded = true;
      delete virtualFile.contentPromise;
      return virtualFile;
    }

    // Start loading
    const loadPromise = this.loadContentFn(path);
    virtualFile.contentPromise = loadPromise;

    try {
      const result = await loadPromise;
      virtualFile.content = result.content;
      virtualFile.tokenCount = result.tokenCount;
      virtualFile.isContentLoaded = true;
      // Use actual memory size, not disk size
      this.currentCacheSize += new Blob([result.content]).size;
      delete virtualFile.contentPromise;
      
      this.enforceMemoryLimit();
      return virtualFile;
    } catch (error) {
      delete virtualFile.contentPromise;
      throw error;
    }
  }

  async loadMultipleFiles(paths: string[]): Promise<Map<string, VirtualFileData>> {
    const results = new Map<string, VirtualFileData>();
    
    // Load in parallel with concurrency limit
    const concurrency = 5;
    for (let i = 0; i < paths.length; i += concurrency) {
      const batch = paths.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(path => this.loadFileContent(path).catch(err => {
          console.error(`Failed to load ${path}:`, err);
          return null;
        }))
      );
      
      batch.forEach((path, index) => {
        const result = batchResults[index];
        if (result) {
          results.set(path, result);
        }
      });
    }
    
    return results;
  }

  private enforceMemoryLimit(): void {
    if (this.currentCacheSize <= this.maxCacheSize) {
      return;
    }

    // Sort by last access (approximated by iteration order)
    const entries = Array.from(this.fileCache.entries());
    
    // Remove least recently used files until under limit
    while (this.currentCacheSize > this.maxCacheSize && entries.length > 0) {
      const [_path, file] = entries.shift()!;
      if (file.isContentLoaded && file.content) {
        // Calculate actual memory size before clearing
        const contentSize = new Blob([file.content]).size;
        this.currentCacheSize -= contentSize;
        file.content = undefined;
        file.tokenCount = undefined;
        file.isContentLoaded = false;
      }
    }
  }

  unloadFileContent(path: string): void {
    const virtualFile = this.fileCache.get(path);
    if (virtualFile && virtualFile.isContentLoaded && virtualFile.content) {
      // Calculate actual memory size before clearing
      const contentSize = new Blob([virtualFile.content]).size;
      this.currentCacheSize -= contentSize;
      virtualFile.content = undefined;
      virtualFile.tokenCount = undefined;
      virtualFile.isContentLoaded = false;
    }
  }

  getVirtualFile(path: string): VirtualFileData | undefined {
    return this.fileCache.get(path);
  }

  getAllVirtualFiles(): VirtualFileData[] {
    return Array.from(this.fileCache.values());
  }

  getMetadataOnly(): Array<VirtualFileData['metadata']> {
    return Array.from(this.fileCache.values()).map(f => f.metadata);
  }

  getCacheStats() {
    const loadedFiles = Array.from(this.fileCache.values()).filter(f => f.isContentLoaded);
    return {
      totalFiles: this.fileCache.size,
      loadedFiles: loadedFiles.length,
      cacheSize: this.currentCacheSize,
      maxCacheSize: this.maxCacheSize,
      utilizationPercent: (this.currentCacheSize / this.maxCacheSize) * 100
    };
  }

  clear(): void {
    this.fileCache.clear();
    this.loadQueue.clear();
    this.currentCacheSize = 0;
  }
}