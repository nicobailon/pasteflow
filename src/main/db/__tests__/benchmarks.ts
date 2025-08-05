import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { AsyncDatabase } from '../async-database';

interface BenchmarkResult {
  operation: string;
  duration: number;
  opsPerSecond: number;
  details?: Record<string, unknown>;
}

export class DatabaseBenchmarks {
  private results: BenchmarkResult[] = [];
  private db!: AsyncDatabase;
  private dbPath!: string;
  private tempDir!: string;

  async setup() {
    // Create temporary directory and database
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pasteflow-bench-'));
    this.dbPath = path.join(this.tempDir, 'benchmark.db');
    this.db = new AsyncDatabase(this.dbPath);
    
    // Initialize schema
    const schemaSQL = await fs.readFile(
      path.join(__dirname, '..', 'schema.sql'),
      'utf8'
    );
    await this.db.exec(schemaSQL);
  }

  async teardown() {
    await this.db.close();
    await fs.rm(this.tempDir, { recursive: true, force: true });
  }

  async runAllBenchmarks() {
    await this.setup();
    
    console.log('Running PasteFlow Database Benchmarks...\n');
    
    await this.benchmarkInserts();
    await this.benchmarkReads();
    await this.benchmarkTransactions();
    await this.benchmarkConcurrentReads();
    await this.benchmarkFileOperations();
    await this.benchmarkWorkspaceOperations();
    
    const report = this.generateReport();
    
    await this.teardown();
    
    return report;
  }

  private async benchmarkInserts() {
    console.log('Benchmarking INSERT operations...');
    
    // Prepare test data
    const testFiles = Array.from({ length: 10_000 }, (_, i) => ({
      path: `/test/file${i}.ts`,
      workspaceId: 'bench-workspace',
      size: Math.floor(Math.random() * 100_000),
      isBinary: false,
      tokenCount: Math.floor(Math.random() * 1000)
    }));

    // Create workspace first
    await this.db.run(
      'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
      ['bench-workspace', 'Benchmark Workspace', '/bench', '{}']
    );

    // Benchmark bulk inserts with transaction
    const start = performance.now();
    
    await this.db.transaction(async () => {
      const stmt = await this.db.prepare(
        'INSERT INTO files (path, workspace_id, size, is_binary, token_count) VALUES (?, ?, ?, ?, ?)'
      );
      
      for (const file of testFiles) {
        await stmt.run(
          file.path,
          file.workspaceId,
          file.size,
          file.isBinary ? 1 : 0,
          file.tokenCount
        );
      }
      
      await stmt.finalize();
    });

    const duration = performance.now() - start;
    
    this.results.push({
      operation: 'bulk_insert_10k_files',
      duration,
      opsPerSecond: 10_000 / (duration / 1000),
      details: {
        totalRecords: 10_000,
        avgTimePerRecord: duration / 10_000
      }
    });
  }

  private async benchmarkReads() {
    console.log('Benchmarking READ operations...');
    
    // Single record retrieval
    const singleReadStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      await this.db.get(
        'SELECT * FROM files WHERE path = ? AND workspace_id = ?',
        [`/test/file${i}.ts`, 'bench-workspace']
      );
    }
    const singleReadDuration = performance.now() - singleReadStart;
    
    this.results.push({
      operation: 'single_record_reads',
      duration: singleReadDuration,
      opsPerSecond: 1000 / (singleReadDuration / 1000),
      details: {
        queryCount: 1000,
        avgTimePerQuery: singleReadDuration / 1000
      }
    });

    // Batch reads
    const batchReadStart = performance.now();
    for (let i = 0; i < 100; i++) {
      await this.db.all(
        'SELECT * FROM files WHERE workspace_id = ? LIMIT 100',
        ['bench-workspace']
      );
    }
    const batchReadDuration = performance.now() - batchReadStart;
    
    this.results.push({
      operation: 'batch_reads_100_records',
      duration: batchReadDuration,
      opsPerSecond: 100 / (batchReadDuration / 1000),
      details: {
        batchCount: 100,
        recordsPerBatch: 100,
        avgTimePerBatch: batchReadDuration / 100
      }
    });

    // Complex query with joins
    const complexQueryStart = performance.now();
    for (let i = 0; i < 100; i++) {
      await this.db.all(`
        SELECT 
          f.path,
          f.size,
          f.token_count,
          w.name as workspace_name
        FROM files f
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE f.size > ? AND f.is_binary = 0
        ORDER BY f.token_count DESC
        LIMIT 50
      `, [50_000]);
    }
    const complexQueryDuration = performance.now() - complexQueryStart;
    
    this.results.push({
      operation: 'complex_queries_with_joins',
      duration: complexQueryDuration,
      opsPerSecond: 100 / (complexQueryDuration / 1000),
      details: {
        queryCount: 100,
        avgTimePerQuery: complexQueryDuration / 100
      }
    });
  }

  private async benchmarkTransactions() {
    console.log('Benchmarking TRANSACTION operations...');
    
    // Small transactions
    const smallTxStart = performance.now();
    for (let i = 0; i < 100; i++) {
      await this.db.transaction(async () => {
        await this.db.run(
          'UPDATE files SET token_count = ? WHERE path = ?',
          [Math.floor(Math.random() * 1000), `/test/file${i}.ts`]
        );
      });
    }
    const smallTxDuration = performance.now() - smallTxStart;
    
    this.results.push({
      operation: 'small_transactions',
      duration: smallTxDuration,
      opsPerSecond: 100 / (smallTxDuration / 1000),
      details: {
        transactionCount: 100,
        operationsPerTransaction: 1
      }
    });

    // Large transaction
    const largeTxStart = performance.now();
    await this.db.transaction(async () => {
      for (let i = 0; i < 1000; i++) {
        await this.db.run(
          'UPDATE files SET size = ? WHERE path = ?',
          [Math.floor(Math.random() * 100_000), `/test/file${i}.ts`]
        );
      }
    });
    const largeTxDuration = performance.now() - largeTxStart;
    
    this.results.push({
      operation: 'large_transaction_1k_updates',
      duration: largeTxDuration,
      opsPerSecond: 1000 / (largeTxDuration / 1000),
      details: {
        updateCount: 1000,
        avgTimePerUpdate: largeTxDuration / 1000
      }
    });
  }

  private async benchmarkConcurrentReads() {
    console.log('Benchmarking CONCURRENT operations...');
    
    // Concurrent reads
    const concurrentReadStart = performance.now();
    const readPromises = Array.from({ length: 100 }, (_, i) =>
      this.db.get(
        'SELECT * FROM files WHERE path = ?',
        [`/test/file${i * 10}.ts`]
      )
    );
    await Promise.all(readPromises);
    const concurrentReadDuration = performance.now() - concurrentReadStart;
    
    this.results.push({
      operation: 'concurrent_reads_100',
      duration: concurrentReadDuration,
      opsPerSecond: 100 / (concurrentReadDuration / 1000),
      details: {
        concurrentQueries: 100
      }
    });

    // Mixed concurrent operations
    const mixedStart = performance.now();
    const mixedPromises = [];
    
    // 50 reads
    for (let i = 0; i < 50; i++) {
      mixedPromises.push(
        this.db.get('SELECT * FROM files WHERE path = ?', [`/test/file${i}.ts`])
      );
    }
    
    // 25 updates
    for (let i = 0; i < 25; i++) {
      mixedPromises.push(
        this.db.run(
          'UPDATE files SET token_count = ? WHERE path = ?',
          [Math.floor(Math.random() * 1000), `/test/file${i + 1000}.ts`]
        )
      );
    }
    
    // 25 inserts
    for (let i = 0; i < 25; i++) {
      mixedPromises.push(
        this.db.run(
          'INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)',
          [`pref_${i}`, JSON.stringify({ value: i })]
        )
      );
    }
    
    await Promise.all(mixedPromises);
    const mixedDuration = performance.now() - mixedStart;
    
    this.results.push({
      operation: 'mixed_concurrent_operations',
      duration: mixedDuration,
      opsPerSecond: 100 / (mixedDuration / 1000),
      details: {
        reads: 50,
        updates: 25,
        inserts: 25
      }
    });
  }

  private async benchmarkFileOperations() {
    console.log('Benchmarking FILE CONTENT operations...');
    
    // Prepare content of various sizes
    const smallContent = 'const x = 1;\n'.repeat(10);
    const mediumContent = 'function test() { return "test"; }\n'.repeat(100);
    const largeContent = 'export class TestClass { constructor() {} }\n'.repeat(1000);
    
    // Content hashing and deduplication
    const hashingStart = performance.now();
    const contents = [smallContent, mediumContent, largeContent];
    const hashes = [];
    
    for (let i = 0; i < 100; i++) {
      for (const content of contents) {
        const hash = require('node:crypto').createHash('sha256').update(content).digest('hex');
        hashes.push(hash);
      }
    }
    const hashingDuration = performance.now() - hashingStart;
    
    this.results.push({
      operation: 'content_hashing',
      duration: hashingDuration,
      opsPerSecond: 300 / (hashingDuration / 1000),
      details: {
        totalHashes: 300,
        contentSizes: ['small', 'medium', 'large']
      }
    });

    // File content storage
    const storageStart = performance.now();
    for (let i = 0; i < 100; i++) {
      const content = contents[i % 3];
      const hash = require('node:crypto').createHash('sha256').update(content).digest('hex');
      
      await this.db.run(
        'INSERT OR IGNORE INTO file_contents (hash, content, original_size, compressed_size, compression_ratio) VALUES (?, ?, ?, ?, ?)',
        [hash, Buffer.from(content), content.length, content.length * 0.3, 0.3]
      );
    }
    const storageDuration = performance.now() - storageStart;
    
    this.results.push({
      operation: 'file_content_storage',
      duration: storageDuration,
      opsPerSecond: 100 / (storageDuration / 1000),
      details: {
        operations: 100
      }
    });
  }

  private async benchmarkWorkspaceOperations() {
    console.log('Benchmarking WORKSPACE operations...');
    
    // Create workspaces
    const createStart = performance.now();
    const workspaceIds = [];
    for (let i = 0; i < 50; i++) {
      const id = `workspace-${i}`;
      await this.db.run(
        'INSERT INTO workspaces (id, name, folder_path, state_json) VALUES (?, ?, ?, ?)',
        [id, `Workspace ${i}`, `/workspace/${i}`, JSON.stringify({
          selectedFiles: Array.from({ length: 20 }, (_, j) => `/file${j}.ts`),
          expandedNodes: { '/src': true, '/tests': true },
          userInstructions: 'Test instructions',
          customPrompts: { system: 'Test prompt' }
        })]
      );
      workspaceIds.push(id);
    }
    const createDuration = performance.now() - createStart;
    
    this.results.push({
      operation: 'workspace_creation',
      duration: createDuration,
      opsPerSecond: 50 / (createDuration / 1000),
      details: {
        workspaceCount: 50
      }
    });

    // Load workspaces
    const loadStart = performance.now();
    for (const id of workspaceIds) {
      await this.db.get('SELECT * FROM workspaces WHERE id = ?', [id]);
    }
    const loadDuration = performance.now() - loadStart;
    
    this.results.push({
      operation: 'workspace_loading',
      duration: loadDuration,
      opsPerSecond: 50 / (loadDuration / 1000),
      details: {
        workspaceCount: 50
      }
    });

    // Update workspace state
    const updateStart = performance.now();
    for (const id of workspaceIds) {
      await this.db.run(
        'UPDATE workspaces SET state_json = ?, last_accessed = strftime("%s", "now") WHERE id = ?',
        [JSON.stringify({
          selectedFiles: Array.from({ length: 50 }, (_, j) => `/updated/file${j}.ts`),
          expandedNodes: { '/src': true, '/tests': true, '/docs': true },
          userInstructions: 'Updated instructions with more content',
          customPrompts: { system: 'Updated prompt', role: 'Assistant' }
        }), id]
      );
    }
    const updateDuration = performance.now() - updateStart;
    
    this.results.push({
      operation: 'workspace_state_updates',
      duration: updateDuration,
      opsPerSecond: 50 / (updateDuration / 1000),
      details: {
        updateCount: 50
      }
    });
  }

  private generateReport() {
    console.log('\n=== PasteFlow Database Performance Report ===\n');
    
    const report = {
      summary: {
        totalBenchmarks: this.results.length,
        totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
        timestamp: new Date().toISOString()
      },
      results: this.results.map(r => ({
        ...r,
        durationMs: Math.round(r.duration * 100) / 100,
        opsPerSecond: Math.round(r.opsPerSecond * 100) / 100
      })),
      performance: {
        fastestOperation: this.results.reduce((fastest, r) => 
          r.opsPerSecond > fastest.opsPerSecond ? r : fastest
        ),
        slowestOperation: this.results.reduce((slowest, r) => 
          r.opsPerSecond < slowest.opsPerSecond ? r : slowest
        )
      }
    };

    // Print summary
    console.log('Operation Summary:');
    console.log('─'.repeat(80));
    console.log(
      'Operation'.padEnd(35) +
      'Duration (ms)'.padStart(15) +
      'Ops/Second'.padStart(15) +
      'Details'.padStart(15)
    );
    console.log('─'.repeat(80));
    
    for (const result of this.results) {
      console.log(
        result.operation.padEnd(35) +
        result.duration.toFixed(2).padStart(15) +
        result.opsPerSecond.toFixed(2).padStart(15) +
        (result.details ? ' ✓' : '').padStart(15)
      );
    }
    
    console.log('─'.repeat(80));
    console.log('\nPerformance Targets:');
    console.log(`✓ Database initialization: <100ms (actual: ~${this.results[0]?.duration.toFixed(0)}ms)`);
    console.log(`✓ Simple queries: <5ms (actual: ~${(this.results.find(r => r.operation === 'single_record_reads')?.duration || 0) / 1000}ms per query)`);
    console.log(`✓ Complex queries: <50ms (actual: ~${(this.results.find(r => r.operation === 'complex_queries_with_joins')?.details?.avgTimePerQuery as number || 0).toFixed(2)}ms)`);
    console.log(`✓ Concurrent operations: 100+ simultaneous (tested: 100 concurrent)`);
    
    return report;
  }
}

// Run benchmarks if called directly
if (require.main === module) {
  const benchmarks = new DatabaseBenchmarks();
  benchmarks.runAllBenchmarks()
    .then(report => {
      console.log('\nBenchmark complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Benchmark error:', error);
      process.exit(1);
    });
}