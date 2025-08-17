// Minimal logger utility for development/production logging control
const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

// More restrictive and explicit type definitions for better type safety
type Primitive = string | number | boolean | undefined | null | bigint | symbol;
type SerializableObject = Record<string, unknown>;
type LogValue = Primitive | Error | SerializableObject | Array<Primitive | SerializableObject>;
type LogArg = LogValue;

// Type-safe noop function that matches console method signatures
const noop: (...args: LogArg[]) => void = () => { /* no-op */ };

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  error: console.error.bind(console), // Keep errors in all environments
};