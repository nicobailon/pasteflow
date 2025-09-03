import { toKebabCase, toPascalCase } from "./component";

export function generateHook(name: string) {
  const base = name.startsWith('use') ? name : `use-${name}`;
  const kebab = toKebabCase(base);
  const file = `src/hooks/${kebab}.ts`;
  const content = `import { useEffect, useState } from "react";

export function ${toPascalCase(base)}() {
  const [state, setState] = useState(null as null | unknown);
  useEffect(() => { /* init */ }, []);
  return state;
}
`;
  return [{ path: file, content }];
}

