// Mock for react-syntax-highlighter compatible with both ESM and CJS import styles
import React from 'react';

type SyntaxHighlighterProps = {
  children?: React.ReactNode;
  [key: string]: unknown;
};

const SyntaxHighlighter = ({ children, ...props }: SyntaxHighlighterProps) =>
  React.createElement('pre', { 'data-testid': 'syntax-highlighter', ...props }, children);

// Export component variants
export const Prism = SyntaxHighlighter;
export const Light = SyntaxHighlighter;

// Mock styles (empty objects)
export const oneDark: Record<string, unknown> = {};
export const oneLight: Record<string, unknown> = {};

// Provide a broad set of style tokens for mapped dist paths
export const coy = {};
export const dark = {};
export const funky = {};
export const okaidia = {};
export const solarizedlight = {};
export const tomorrow = {};
export const twilight = {};
export const prism = {};
export const atomDark = {};
export const base16AteliersulphurpoolLight = {};
export const cb = {};
export const darcula = {};
export const dracula = {};
export const duotoneDark = {};
export const duotoneEarth = {};
export const duotoneForest = {};
export const duotoneLight = {};
export const duotoneSea = {};
export const duotoneSpace = {};
export const ghcolors = {};
export const hopscotch = {};
export const materialDark = {};
export const materialLight = {};
export const materialOceanic = {};
export const nord = {};
export const pojoaque = {};
export const solarizedDarkAtom = {};
export const synthwave84 = {};
export const vs = {};
export const vscDarkPlus = {};
export const xonokai = {};

// CommonJS compatibility: many consumers expect CJS shape
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(module as any).exports = {
  Prism: SyntaxHighlighter,
  Light: SyntaxHighlighter,
  oneDark,
  oneLight,
  coy,
  dark,
  funky,
  okaidia,
  solarizedlight,
  tomorrow,
  twilight,
  prism,
  atomDark,
  base16AteliersulphurpoolLight,
  cb,
  darcula,
  dracula,
  duotoneDark,
  duotoneEarth,
  duotoneForest,
  duotoneLight,
  duotoneSea,
  duotoneSpace,
  ghcolors,
  hopscotch,
  materialDark,
  materialLight,
  materialOceanic,
  nord,
  pojoaque,
  solarizedDarkAtom,
  synthwave84,
  vs,
  vscDarkPlus,
  xonokai,
};