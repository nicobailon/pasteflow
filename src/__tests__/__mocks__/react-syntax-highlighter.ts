// Mock for react-syntax-highlighter compatible with both ESM and CJS import styles
import React from 'react';

type LineProps = Record<string, unknown> | ((lineNumber: number) => Record<string, unknown>);
type SyntaxHighlighterProps = {
  children?: React.ReactNode;
  language?: string;
  style?: React.CSSProperties;
  showLineNumbers?: boolean;
  wrapLines?: boolean;
  lineProps?: LineProps;
  lineNumberStyle?: React.CSSProperties | ((lineNumber: number) => React.CSSProperties);
  customStyle?: React.CSSProperties;
  codeTagProps?: { [key: string]: unknown };
  className?: string;
  [key: string]: unknown;
};

const sanitizeDomProps = (props: Record<string, unknown>) => {
  const {
    // react-syntax-highlighter specific (non-DOM) props
    showLineNumbers, wrapLines, lineProps, lineNumberStyle, customStyle, codeTagProps,
    language,
    children,
    ...rest
  } = props;

  const {
    className, style, id, title, role, tabIndex,
    onClick, onMouseDown, onMouseMove, onMouseUp, onKeyDown, onKeyUp, onKeyPress,
    'aria-label': ariaLabel, 'aria-describedby': ariaDescribedby, 'data-testid': dataTestId
  } = rest as Record<string, unknown>;

  const safe: Record<string, unknown> = {
    className,
    style: (customStyle as React.CSSProperties) || (style as React.CSSProperties),
    id,
    title,
    role,
    tabIndex,
    onClick,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onKeyDown,
    onKeyUp,
    onKeyPress,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    'data-testid': dataTestId ?? 'syntax-highlighter',
    'data-language': language,
    'data-show-line-numbers': showLineNumbers ? true : undefined,
    'data-wrap-lines': wrapLines ? true : undefined,
  };
  Object.keys(safe).forEach((k) => {
    if (safe[k] === undefined) delete safe[k];
  });
  return safe;
};

const renderLines = (
  text: string,
  opts: {
    lineProps?: LineProps;
    lineNumberStyle?: SyntaxHighlighterProps['lineNumberStyle'];
    codeTagProps?: Record<string, unknown>;
  }
) => {
  const { lineProps, lineNumberStyle, codeTagProps } = opts;
  const lines = text.split('\n');

  return lines.map((line, idx) => {
    const lineNumber = idx + 1;
    const computedLineProps =
      typeof lineProps === 'function' ? (lineProps as (n: number) => Record<string, unknown>)(lineNumber) : (lineProps || {});
    const computedLineNumberStyle =
      typeof lineNumberStyle === 'function' ? (lineNumberStyle as (n: number) => React.CSSProperties)(lineNumber) : (lineNumberStyle || {});

    const { children: _ignoredChildren, ...safeComputed } = (computedLineProps || {}) as Record<string, unknown>;

    return React.createElement(
      'div',
      { key: lineNumber, 'data-line-number': lineNumber, ...safeComputed },
      [
        React.createElement('span', { key: 'ln', style: computedLineNumberStyle as React.CSSProperties }, String(lineNumber)),
        React.createElement('code', { key: 'code', ...(codeTagProps || {}) }, line),
      ]
    );
  });
};

const SyntaxHighlighter = (props: SyntaxHighlighterProps) => {
  const {
    children,
    showLineNumbers,
    wrapLines,
    lineProps,
    lineNumberStyle,
    customStyle,
    codeTagProps,
    language,
    style,
    ...rest
  } = props;

  const safePreProps = sanitizeDomProps({
    children,
    showLineNumbers,
    wrapLines,
    lineProps,
    lineNumberStyle,
    customStyle,
    codeTagProps,
    language,
    style,
    ...rest,
  });

  const content = typeof children === 'string' ? children : '';

  // If any line-level behavior is requested, simulate per-line rendering
  if (wrapLines || lineProps || lineNumberStyle || showLineNumbers) {
    return React.createElement('pre', safePreProps, renderLines(content, { lineProps, lineNumberStyle, codeTagProps }));
  }

  // Simple fallback: render a single code block
  return React.createElement('pre', safePreProps, React.createElement('code', { ...(codeTagProps || {}) }, children));
};

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