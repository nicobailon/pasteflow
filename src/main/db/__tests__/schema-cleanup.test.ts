import fs from 'fs';
import path from 'path';

describe('database schema cleanup', () => {
  it('should not contain legacy custom_prompts artifacts', () => {
    const schemaPath = path.join(process.cwd(), 'src', 'main', 'db', 'database-implementation.ts');
    const code = fs.readFileSync(schemaPath, 'utf8');
    expect(code).not.toContain('custom_prompts');
    expect(code).not.toContain('idx_prompts_name');
  });
});