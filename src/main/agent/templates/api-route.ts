import { toKebabCase, toPascalCase } from "./component";

export function generateApiRoute(name: string) {
  const kebab = toKebabCase(name);
  const handler = `${toPascalCase(name)}Handler`;
  const file = `src/main/routes/${kebab}.ts`;
  const content = `import type { Request, Response } from 'express';

export async function ${handler}(req: Request, res: Response) {
  try {
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: String((error as Error)?.message || error) });
  }
}

// Registration hint:
// In src/main/api-server.ts, register route: app.get('/api/v1/${kebab}', (req, res) => ${handler}(req, res));
`;
  return [{ path: file, content }];
}
