/* eslint-disable @typescript-eslint/no-var-requires */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { platform as osPlatform } from 'node:os';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Check for required dependencies
try {
  // Test loading key dependencies
  require('ignore');
  require('tiktoken');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Missing dependency: ${message}`);
  console.error('Please run: npm install\n');
  process.exit(1);
}

console.log('🚀 Starting development environment...');

// Set environment variable for development mode
process.env.NODE_ENV = 'development';

// Default port
let vitePort = 3000;

// Start Vite dev server
console.log('📦 Starting Vite dev server...');
const viteProcess = spawn('npm', ['run', 'dev'], {
  stdio: ['inherit', 'pipe', 'inherit'], // Pipe stdout to capture the port
  shell: osPlatform() === 'win32', // Use shell on Windows
});

// Flag to track if Vite has started
let viteStarted = false;
let mainWatch: ChildProcess | null = null;

// Listen for Vite server ready message
viteProcess.stdout?.on('data', (data: Buffer) => {
  const output = data.toString();
  console.log(output); // Echo output to console

  // Extract port from the output (e.g., "Local: http://localhost:3001/")
  const portMatch = output.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (portMatch?.[1]) {
    vitePort = Number.parseInt(portMatch[1], 10);
    console.log(`🔍 Detected Vite server running on port ${vitePort}`);
  }

  if (output.includes('Local:') && !viteStarted) {
    viteStarted = true;
    startElectron();
  }
});

// Listen for errors that might indicate port conflicts
const viteStderr = viteProcess.stderr as import('stream').Readable | null;
viteStderr?.on('data', (data: Buffer) => {
  const output = data.toString();
  console.error(output); // Echo error output to console

  if (output.includes('Port 3000 is already in use')) {
    console.error('\n❌ Port 3000 is already in use. Try one of the following:');
    console.error("  1. Kill the process using port 3000: 'lsof -i :3000 | grep LISTEN' then 'kill -9 [PID]'");
    console.error('  2. Change the Vite port in vite.config.ts');
    console.error('  3. Restart your computer if the issue persists\n');
  }
});

// Start Electron after a delay if Vite hasn't reported ready
setTimeout(() => {
  if (!viteStarted) {
    console.log('⚠️ Vite server might not be ready yet, but starting Electron anyway...');
    startElectron();
  }
}, 5000); // Wait 5 seconds before attempting to start Electron

function startElectron(): void {
  console.log(`🔌 Starting Electron app with Vite server at port ${vitePort}...`);

  // Build schemas only (tsx will handle TypeScript at runtime)
  try {

    // Compile main once, then start a watcher for incremental rebuilds
    console.log('🛠️ Building main (once)...');
    execSync('npm run build:main', { stdio: 'inherit' });

    console.log('🔁 Starting main build watcher...');
    mainWatch = spawn('npm', ['run', 'build:main:watch'], {
      stdio: 'inherit',
      shell: osPlatform() === 'win32',
    });

    // Start Electron
    const electronProcess = spawn('npm', ['start'], {
      stdio: 'inherit',
      shell: osPlatform() === 'win32', // Use shell on Windows
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_START_URL: `http://localhost:${vitePort}`,
        // SECURE_IPC removed - no longer using secure database path
      },
    });

    electronProcess.on('close', (code) => {
      console.log(`Electron process exited with code ${code}`);
      if (mainWatch) {
        try {
          mainWatch.kill();
        } catch {}
      }
      viteProcess.kill();
      process.exit(code ?? 0);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Dev startup failed (schemas or main build step):', message);
    viteProcess.kill();
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down development environment...');
  if (mainWatch) {
    try {
      mainWatch.kill();
    } catch {}
  }
  viteProcess.kill();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Terminating development environment...');
  if (mainWatch) {
    try {
      mainWatch.kill();
    } catch {}
  }
  viteProcess.kill();
  process.exit(143);
});

viteProcess.on('close', (code) => {
  console.log(`Vite process exited with code ${code}`);
  process.exit(code ?? 0);
});