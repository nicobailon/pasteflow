interface SerializedData {
  buffer: SharedArrayBuffer;
  byteLength: number;
}

// Maximum size for SharedArrayBuffer optimization (10MB)
const SHARED_BUFFER_THRESHOLD = 10 * 1024 * 1024;

export class SharedBufferManager {
  private readonly bufferSize = 1024 * 1024; // 1MB chunks
  
  /**
   * Check if SharedArrayBuffer is available in the current context
   */
  private static isSharedArrayBufferSupported(): boolean {
    // Use globalThis to work in Node worker_threads and browser contexts without referencing 'self'
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
    const isIsolated = g && 'crossOriginIsolated' in g ? g.crossOriginIsolated === true : true;
    return typeof SharedArrayBuffer !== 'undefined' && isIsolated;
  }
  
  /**
   * Determines if data is large enough to benefit from SharedArrayBuffer
   */
  shouldUseSharedBuffer(data: unknown): boolean {
    if (!SharedBufferManager.isSharedArrayBufferSupported()) {
      return false;
    }
    
    try {
      const serialized = JSON.stringify(data);
      return serialized.length > SHARED_BUFFER_THRESHOLD;
    } catch {
      return false;
    }
  }
  
  /**
   * Serializes data to SharedArrayBuffer for efficient transfer
   */
  serializeToSharedBuffer(data: unknown): SerializedData | null {
    if (!SharedBufferManager.isSharedArrayBufferSupported()) {
      return null;
    }
    
    try {
      const jsonStr = JSON.stringify(data);
      const encoder = new TextEncoder();
      const encoded = encoder.encode(jsonStr);
      
      // Create SharedArrayBuffer with exact size needed
      const buffer = new SharedArrayBuffer(encoded.byteLength);
      const view = new Uint8Array(buffer);
      view.set(encoded);
      
      return {
        buffer,
        byteLength: encoded.byteLength
      };
    } catch (error) {
      console.error('Failed to serialize to SharedArrayBuffer:', error);
      return null;
    }
  }
  
  /**
   * Deserializes data from SharedArrayBuffer
   */
  deserializeFromSharedBuffer(buffer: SharedArrayBuffer, byteLength: number): unknown {
    try {
      const view = new Uint8Array(buffer, 0, byteLength);
      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(view);
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to deserialize from SharedArrayBuffer:', error);
      throw error;
    }
  }
  
  /**
   * Chunks large data for streaming transfer
   */
  *chunkData(data: unknown, chunkSize: number = this.bufferSize): Generator<SerializedData> {
    if (!SharedBufferManager.isSharedArrayBufferSupported()) {
      return;
    }
    
    const jsonStr = JSON.stringify(data);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(jsonStr);
    
    for (let offset = 0; offset < encoded.byteLength; offset += chunkSize) {
      const remaining = Math.min(chunkSize, encoded.byteLength - offset);
      const buffer = new SharedArrayBuffer(remaining);
      const view = new Uint8Array(buffer);
      view.set(encoded.slice(offset, offset + remaining));
      
      yield {
        buffer,
        byteLength: remaining
      };
    }
  }
  
  /**
   * Measures the serialization overhead
   */
  measureOverhead(data: unknown): { jsonSize: number; sharedBufferSize: number; savings: number } {
    const jsonStr = JSON.stringify(data);
    const jsonSize = jsonStr.length;
    
    const encoder = new TextEncoder();
    const encoded = encoder.encode(jsonStr);
    const sharedBufferSize = encoded.byteLength;
    
    const savings = ((jsonSize - sharedBufferSize) / jsonSize) * 100;
    
    return {
      jsonSize,
      sharedBufferSize,
      savings
    };
  }
}

// Singleton instance
export const sharedBufferManager = new SharedBufferManager();