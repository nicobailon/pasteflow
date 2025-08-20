import { PERFORMANCE } from '@constants';

export interface PerformanceMetrics {
  renderTime: number;
  lineCount: number;
  timestamp: number;
  memoryUsed?: number;
}

export class FileViewerPerformanceMonitor {
  private static instance: FileViewerPerformanceMonitor | null = null;
  private metrics: PerformanceMetrics[] = [];
  private maxMetrics = PERFORMANCE.MAX_MEASUREMENTS;
  
  private constructor() {}
  
  static getInstance(): FileViewerPerformanceMonitor {
    if (!FileViewerPerformanceMonitor.instance) {
      FileViewerPerformanceMonitor.instance = new FileViewerPerformanceMonitor();
    }
    return FileViewerPerformanceMonitor.instance;
  }
  
  measureRenderTime(lineCount: number, callback: () => void): number {
    const start = performance.now();
    
    // Type-safe performance memory access
    const performanceWithMemory = performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    
    const initialMemory = performanceWithMemory.memory?.usedJSHeapSize || 0;
    
    callback();
    
    const end = performance.now();
    const finalMemory = performanceWithMemory.memory?.usedJSHeapSize || 0;
    const renderTime = end - start;
    
    const metric: PerformanceMetrics = {
      renderTime,
      lineCount,
      timestamp: Date.now(),
      memoryUsed: finalMemory - initialMemory,
    };
    
    this.addMetric(metric);
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[FileViewer Performance] Lines: ${lineCount}, Render: ${renderTime.toFixed(2)}ms, Memory: ${((metric.memoryUsed || 0) / 1024 / 1024).toFixed(2)}MB`);
    }
    
    return renderTime;
  }
  
  private addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);
    
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }
  
  shouldUseVirtualization(lineCount: number): boolean {
    return lineCount > 1000;
  }
  
  getPerformanceThreshold(lineCount: number): number {
    if (lineCount < 1000) return 100;
    if (lineCount < 5000) return 500;
    return 1000;
  }
  
  getAverageRenderTime(lineCount?: number): number | null {
    const relevantMetrics = lineCount 
      ? this.metrics.filter(m => Math.abs(m.lineCount - lineCount) < lineCount * 0.1)
      : this.metrics;
    
    if (relevantMetrics.length === 0) return null;
    
    const sum = relevantMetrics.reduce((acc, m) => acc + m.renderTime, 0);
    return sum / relevantMetrics.length;
  }
  
  getRecentMetrics(ageMs: number = PERFORMANCE.REPORT_AGE_THRESHOLD_MS): PerformanceMetrics[] {
    const cutoff = Date.now() - ageMs;
    return this.metrics.filter(m => m.timestamp > cutoff);
  }
  
  clearMetrics(): void {
    this.metrics = [];
  }
  
  getMetricsSummary(): {
    totalMetrics: number;
    averageRenderTime: number | null;
    maxRenderTime: number | null;
    minRenderTime: number | null;
    averageMemoryUsed: number | null;
  } {
    if (this.metrics.length === 0) {
      return {
        totalMetrics: 0,
        averageRenderTime: null,
        maxRenderTime: null,
        minRenderTime: null,
        averageMemoryUsed: null,
      };
    }
    
    const renderTimes = this.metrics.map(m => m.renderTime);
    const memoryUsages = this.metrics.filter(m => m.memoryUsed !== undefined).map(m => m.memoryUsed!);
    
    return {
      totalMetrics: this.metrics.length,
      averageRenderTime: renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length,
      maxRenderTime: Math.max(...renderTimes),
      minRenderTime: Math.min(...renderTimes),
      averageMemoryUsed: memoryUsages.length > 0 
        ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length 
        : null,
    };
  }
}

export const fileViewerPerformance = FileViewerPerformanceMonitor.getInstance();