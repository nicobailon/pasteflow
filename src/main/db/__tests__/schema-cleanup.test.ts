import fs from 'node:fs';
import path from 'node:path';

describe('database schema cleanup', () => {
  it('should not contain legacy custom_prompts artifacts', () => {
    const schemaPath = path.join(process.cwd(), 'src', 'main', 'db', 'database-implementation.ts');
    const code = fs.readFileSync(schemaPath, 'utf8');
    const normalized = code.replace(/\s+/g, ' ');

    expect(normalized).not.toMatch(/create\s+table\s+custom_prompts/i);
    expect(normalized).not.toMatch(/create\s+index\s+idx_prompts_name/i);
  });
});
