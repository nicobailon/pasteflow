import { toKebabCase, toPascalCase } from "./component";

export function generateTest(kind: 'component' | 'hook' | 'api-route', name: string) {
  const kebab = toKebabCase(name);
  const pascal = toPascalCase(name);
  if (kind === 'component') {
    const file = `src/__tests__/${kebab}.test.tsx`;
    const content = `import { ${pascal} } from "../components/${kebab}";\n\n// TODO: add real tests for ${pascal}\n`;
    return [{ path: file, content }];
  }
  if (kind === 'hook') {
    const base = name.startsWith('use') ? name : `use-${name}`;
    const hookKebab = toKebabCase(base);
    const file = `src/hooks/__tests__/${hookKebab}.test.ts`;
    const content = `import { ${toPascalCase(base)} } from "../../hooks/${hookKebab}";\n\n// TODO: add real tests for hook\n`;
    return [{ path: file, content }];
  }
  // api-route
  const file = `src/main/__tests__/${kebab}-route.test.ts`;
  const content = `// TODO: wire API server test for /api/v1/${kebab}\n`;
  return [{ path: file, content }];
}
