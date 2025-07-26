// Mock for react-syntax-highlighter
const React = require('react');

const SyntaxHighlighter = ({ children, ...props }) => {
  return React.createElement('pre', { 'data-testid': 'syntax-highlighter', ...props }, children);
};

const Prism = SyntaxHighlighter;
const Light = SyntaxHighlighter;

// Mock styles
const oneDark = {};
const oneLight = {};

// Re-export from dist paths
const distMock = {
  oneDark: {},
  oneLight: {},
  coy: {},
  dark: {},
  funky: {},
  okaidia: {},
  solarizedlight: {},
  tomorrow: {},
  twilight: {},
  prism: {},
  atomDark: {},
  base16AteliersulphurpoolLight: {},
  cb: {},
  darcula: {},
  dracula: {},
  duotoneDark: {},
  duotoneEarth: {},
  duotoneForest: {},
  duotoneLight: {},
  duotoneSea: {},
  duotoneSpace: {},
  ghcolors: {},
  hopscotch: {},
  materialDark: {},
  materialLight: {},
  materialOceanic: {},
  nord: {},
  pojoaque: {},
  solarizedDarkAtom: {},
  synthwave84: {},
  vs: {},
  vscDarkPlus: {},
  xonokai: {}
};

module.exports = {
  Prism: SyntaxHighlighter,
  Light: SyntaxHighlighter,
  oneDark,
  oneLight,
  ...distMock
};

// Also export named exports for ES6 imports
module.exports.Prism = SyntaxHighlighter;
module.exports.Light = SyntaxHighlighter;
module.exports.oneDark = oneDark;
module.exports.oneLight = oneLight;