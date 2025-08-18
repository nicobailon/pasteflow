// This file mocks file imports for Jest
const stub = 'test-file-stub' as const;
export default stub;
// Ensure CommonJS consumers receive the string directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(module as any).exports = stub;