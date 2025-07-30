export const TEST_CONSTANTS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  LARGE_FILE_SIZE: 2 * 1024 * 1024,
  MEDIUM_FILE_SIZE: 500 * 1024,
  SMALL_FILE_SIZE: 10 * 1024,
  
  MAX_PROCESSING_TIME_1MB: 500,
  MAX_PROCESSING_TIME_100KB: 50,
  WORKER_TIMEOUT: 5000,
  HEALTH_CHECK_INTERVAL: 30000,
  
  MAX_QUEUE_SIZE: 1000,
  OVERFLOW_TEST_SIZE: 1010,
  BATCH_SIZE: 50,
  
  MAX_WORKER_MEMORY: 100 * 1024 * 1024,
  MEMORY_WARNING_THRESHOLD: 80 * 1024 * 1024,
  
  MIN_WORKERS: 1,
  MAX_WORKERS: typeof navigator !== 'undefined' && navigator.hardwareConcurrency 
    ? navigator.hardwareConcurrency 
    : 4,
  
  SAMPLE_TEXT: 'The quick brown fox jumps over the lazy dog',
  SAMPLE_CODE: `
    function fibonacci(n: number): number {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
  `,
  SAMPLE_JSON: JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } }),
  
  KNOWN_TOKEN_COUNTS: {
    'Hello, world!': 4,
    'The quick brown fox jumps over the lazy dog': 9,
    '': 0,
    ' ': 1,
    '\n': 1,
    '😀': 1,
  } as const,
  
  TIMING_TOLERANCE: 50,
  
  MAX_RETRIES: 3,
  RETRY_DELAY: 100,
} as const;

export const generateText = (size: number): string => {
  const chunk = TEST_CONSTANTS.SAMPLE_TEXT;
  const chunkSize = chunk.length;
  const repeats = Math.ceil(size / chunkSize);
  return chunk.repeat(repeats).substring(0, size);
};

export const generateCode = (size: number): string => {
  const base = TEST_CONSTANTS.SAMPLE_CODE;
  const functions: string[] = [];
  let currentSize = 0;
  let index = 0;
  
  while (currentSize < size) {
    functions.push(`
      function generatedFunction${index}() {
        ${base}
      }
    `);
    currentSize += base.length + 50;
    index++;
  }
  
  return functions.join('\n').substring(0, size);
};