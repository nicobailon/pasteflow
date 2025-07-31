export interface PerformanceStats {
  avg: number;
  min: number;
  max: number;
  count: number;
  total: number;
}

export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private enabled: boolean;
  
  constructor(enabled: boolean = process.env.NODE_ENV === 'development') {
    this.enabled = enabled;
  }
  
  startMeasure(label: string): () => void {
    if (!this.enabled) {
      return () => {}; // No-op in production
    }
    
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordMetric(label, duration);
    };
  }
  
  async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return fn();
    }
    
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.recordMetric(label, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(`${label}_error`, duration);
      throw error;
    }
  }
  
  measure<T>(label: string, fn: () => T): T {
    if (!this.enabled) {
      return fn();
    }
    
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      this.recordMetric(label, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(`${label}_error`, duration);
      throw error;
    }
  }
  
  recordMetric(label: string, value: number): void {
    if (!this.enabled) return;
    
    if (!this.metrics.has(label)) {
      this.metrics.set(label, []);
    }
    const values = this.metrics.get(label)!;
    values.push(value);
    
    // Keep only last 1000 measurements to prevent memory leak
    if (values.length > 1000) {
      values.shift();
    }
  }
  
  getStats(label: string): PerformanceStats | null {
    const values = this.metrics.get(label);
    if (!values || values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const total = values.reduce((a, b) => a + b, 0);
    
    return {
      avg: total / values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: values.length,
      total
    };
  }
  
  getAllStats(): Map<string, PerformanceStats> {
    const allStats = new Map<string, PerformanceStats>();
    
    for (const [label] of this.metrics) {
      const stats = this.getStats(label);
      if (stats) {
        allStats.set(label, stats);
      }
    }
    
    return allStats;
  }
  
  clear(label?: string): void {
    if (label) {
      this.metrics.delete(label);
    } else {
      this.metrics.clear();
    }
  }
  
  logReport(filter?: string): void {
    if (!this.enabled) return;
    
    const allStats = this.getAllStats();
    const entries = Array.from(allStats.entries());
    
    if (filter) {
      const filtered = entries.filter(([label]) => label.includes(filter));
      if (filtered.length === 0) {
        return;
      }
      entries.splice(0, entries.length, ...filtered);
    }
    
    // Sort by total time descending
    entries.sort((a, b) => b[1].total - a[1].total);
    
    interface TableRow {
      'Avg (ms)': number;
      'Min (ms)': number;
      'Max (ms)': number;
      'Count': number;
      'Total (ms)': number;
    }
    
    console.group('Performance Report');
    console.table(
      entries.reduce<Record<string, TableRow>>((acc, [label, stats]) => {
        acc[label] = {
          'Avg (ms)': Number(stats.avg.toFixed(2)),
          'Min (ms)': Number(stats.min.toFixed(2)),
          'Max (ms)': Number(stats.max.toFixed(2)),
          'Count': stats.count,
          'Total (ms)': Number(stats.total.toFixed(2))
        };
        return acc;
      }, {})
    );
    console.groupEnd();
  }
  
  // Export metrics as CSV for analysis
  exportCSV(): string {
    const allStats = this.getAllStats();
    const lines: string[] = ['Label,Avg (ms),Min (ms),Max (ms),Count,Total (ms)'];
    
    for (const [label, stats] of allStats) {
      lines.push(
        `"${label}",${stats.avg.toFixed(2)},${stats.min.toFixed(2)},${stats.max.toFixed(2)},${stats.count},${stats.total.toFixed(2)}`
      );
    }
    
    return lines.join('\n');
  }
  
  // Get metrics that exceed a threshold
  getSlowOperations(thresholdMs: number): Array<[string, PerformanceStats]> {
    const allStats = this.getAllStats();
    const slow: Array<[string, PerformanceStats]> = [];
    
    for (const [label, stats] of allStats) {
      if (stats.avg > thresholdMs || stats.max > thresholdMs * 2) {
        slow.push([label, stats]);
      }
    }
    
    return slow.sort((a, b) => b[1].avg - a[1].avg);
  }
}

// Singleton instance for global performance monitoring
let globalMonitor: PerformanceMonitor | null = null;

export function getGlobalPerformanceMonitor(): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor();
  }
  return globalMonitor;
}

// Decorator for measuring method performance
export function measurePerformance<T extends object>(
  target: T,
  propertyName: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  const monitor = getGlobalPerformanceMonitor();
  
  descriptor.value = function (this: T, ...args: unknown[]): unknown {
    const label = `${target.constructor.name}.${propertyName}`;
    return monitor.measure(label, () => originalMethod.apply(this, args));
  };
  
  return descriptor;
}

// Hook for React component performance monitoring
export function usePerformanceMonitor(_componentName: string): PerformanceMonitor {
  const monitor = new PerformanceMonitor();
  
  // Log report on unmount in development
  if (process.env.NODE_ENV === 'development') {
    // Using native useEffect would create circular dependency
    // This is meant to be used with React.useEffect in the component
  }
  
  return monitor;
}