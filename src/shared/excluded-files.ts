export const excludedFiles: string[] = [
  "package-lock.json","yarn.lock","npm-debug.log*","yarn-debug.log*","yarn-error.log*",
  "pnpm-lock.yaml",".npmrc",".yarnrc",".nvmrc","node_modules/**",
  ".eslintrc*",".prettierrc*","tsconfig*.json","*.d.ts","*.min.js","*.map",
  "__pycache__/**","*.pyc","*.pyo","*.pyd",".pytest_cache/**",".coverage",".python-version",
  "venv/**",".venv/**","*.egg-info/**","pip-log.txt","pip-delete-this-directory.txt",
  "go.sum","go.mod","vendor/**",
  "*.class","*.jar","target/**",".gradle/**",
  "Gemfile.lock",".bundle/**",
  "composer.lock","vendor/**",
  "Cargo.lock","target/**",
  "bin/**","obj/**","*.suo","*.user",
  "*.jpg","*.jpeg","*.png","*.gif","*.ico","*.webp","*.svg","*.pdf","*.zip","*.tar.gz","*.tgz","*.rar",
  ".idea/**",".vscode/**","*.swp","*.swo",".DS_Store",
  "dist/**","build/**","out/**",".next/**",
  "logs/**","*.log",
  "*.sqlite","*.db",
  ".env*",".aws/**","*.pem","*.key",
  "docker-compose.override.yml",
  ".git/**",".github/**",".gitlab/**"
];

export const binaryExtensions: string[] = [
  ".svg",".jpg",".jpeg",".png",".gif",".bmp",".tiff",".ico",".webp",
  ".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx"
];