import { getMainTokenService } from "../../services/token-service-main";
import { generateComponent } from "./templates/component";
import { generateHook } from "./templates/hook";
import { generateApiRoute } from "./templates/api-route";
import { generateTest } from "./templates/test";

export type TemplateType = 'component' | 'hook' | 'api-route' | 'test';

export async function generateFromTemplate(name: string, type: TemplateType, options?: Record<string, unknown>) {
  const files = (() => {
    switch (type) {
      case 'component': return generateComponent(String(name), { withCss: true, withTest: false });
      case 'hook': return generateHook(String(name));
      case 'api-route': return generateApiRoute(String(name));
      case 'test': {
        const n = String(name);
        const kind: 'component' | 'hook' = n.trim().toLowerCase().startsWith('use') ? 'hook' : 'component';
        return generateTest(kind, n);
      }
      default: return [] as Array<{ path: string; content: string }>;
    }
  })();

  const tokenService = getMainTokenService();
  let totalTokens = 0;
  for (const f of files) {
    try {
      const { count } = await tokenService.countTokens(f.content);
      totalTokens += count;
    } catch { /* ignore */ }
  }
  const preview = files.map((f) => `- ${f.path} (${Buffer.byteLength(f.content, 'utf8')} bytes)`).join('\n');
  return { files, preview, tokenCount: totalTokens } as const;
}
