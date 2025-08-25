 
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

async function main(): Promise<void> {
  try {
    console.log('📦 Building React app with Vite...');
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ React build completed successfully!');

    // Fix the paths in index.html for Electron compatibility
    const indexHtmlPath = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      let content = fs.readFileSync(indexHtmlPath, 'utf8');

      // Fix asset paths for Electron's file:// protocol
      content = content.replace(/\/assets\//g, './assets/');
      content = content.replace(/(src|href)=["']\//g, '$1="./');
      content = content.replace(/(src|href)=["']\.\.\/assets\//g, '$1="./assets/');

      fs.writeFileSync(indexHtmlPath, content);
      console.log('🔄 Updated asset paths in index.html for Electron compatibility');
    }

    console.log('🚀 Build process completed! The app is ready to run with Electron.');

    // Package the app
    console.log('📦 Packaging application...');
    execSync('npm run package', { stdio: 'inherit' });
    console.log('✅ Packaging completed!');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Build failed:', message);
    process.exit(1);
  }
}

await main();