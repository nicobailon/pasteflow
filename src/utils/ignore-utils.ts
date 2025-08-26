import fs from 'node:fs';
import path from 'node:path';

import ignore from 'ignore';

import { excludedFiles } from '@shared/excluded-files';

interface IgnoreFilter {
  add: (pattern: string | string[]) => void;
  ignores: (path: string) => boolean;
}

export const loadGitignore = (rootDir: string, userPatterns?: string[]): IgnoreFilter => {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    ig.add(gitignoreContent);
  }

  // Add default ignores
  ig.add([".git", "node_modules", ".DS_Store"]);

  // Add the excludedFiles patterns
  ig.add(excludedFiles);

  // Apply user-provided patterns if present
  if (userPatterns?.length) {
    ig.add(userPatterns);
  }

  return ig;
};