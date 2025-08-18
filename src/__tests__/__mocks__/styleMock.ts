// Jest CSS/SCSS module mock
const styles: Record<string, string> = {};
export default styles;

// CommonJS compatibility for consumers expecting module.exports = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(module as any).exports = styles;