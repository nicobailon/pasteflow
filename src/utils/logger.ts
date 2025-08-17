// Minimal logger utility for development/production logging control
const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

type Primitive = string | number | boolean | undefined | null;
type LogValue = Primitive | Error | Record<string, unknown>;
type LogArg = LogValue | LogValue[];
const noop = (..._args: LogArg[]) => { /* no-op */ };

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  error: console.error.bind(console), // Keep errors in all environments
};