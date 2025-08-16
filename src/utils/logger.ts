// Minimal logger utility for development/production logging control
const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

type LogArg = unknown;
const noop = (..._args: LogArg[]) => { /* no-op */ };

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  error: console.error.bind(console), // Keep errors in all environments
};