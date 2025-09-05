export function generateComponent(name: string, opts?: { withCss?: boolean; withTest?: boolean }) {
  const pascal = toPascalCase(name);
  const kebab = toKebabCase(name);
  const files: Array<{ path: string; content: string }> = [];
  const componentPath = `src/components/${kebab}.tsx`;
  const cssPath = `src/components/${kebab}.css`;
  const testPath = `src/__tests__/${kebab}.test.tsx`;

  const tsx = `import React from "react";
import "./${kebab}.css";

export interface ${pascal}Props {
  className?: string;
}

export function ${pascal}({ className }: ${pascal}Props) {
  return (
    <div className={"${kebab}" + (className ? " " + className : "")}>
      ${pascal} works!
    </div>
  );
}

export default ${pascal};
`;

  files.push({ path: componentPath, content: tsx });
  if (opts?.withCss !== false) {
    files.push({ path: cssPath, content: `.${kebab} {\n  /* styles */\n}\n` });
  }
  if (opts?.withTest) {
    files.push({ path: testPath, content: `import { ${pascal} } from "../components/${kebab}";\n\n// TODO: add real tests\n` });
  }
  return files;
}

export function toPascalCase(input: string) {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('');
}

export function toKebabCase(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
