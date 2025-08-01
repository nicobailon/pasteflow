const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

async function testLocalBuild() {
  console.log('Starting local build test...');
  
  const steps = [
    {
      name: 'Clean previous build',
      command: 'rm -rf dist build release-builds'
    },
    {
      name: 'Install dependencies',
      command: 'npm ci'
    },
    {
      name: 'Build native modules',
      command: 'npm run build-native',
      skipOnError: true
    },
    {
      name: 'Run TypeScript checks',
      command: 'npx tsc --noEmit'
    },
    {
      name: 'Run linting',
      command: 'npm run lint'
    },
    {
      name: 'Run tests',
      command: 'npm test'
    },
    {
      name: 'Build application',
      command: 'npm run build'
    },
    {
      name: 'Verify build output',
      verify: async () => {
        const distPath = path.join(process.cwd(), 'dist');
        try {
          const stats = await fs.stat(distPath);
          return stats.isDirectory();
        } catch (error) {
          return false;
        }
      }
    }
  ];

  for (const step of steps) {
    console.log(`\n📌 ${step.name}...`);
    
    if (step.command) {
      try {
        const { stdout, stderr } = await execAsync(step.command);
        if (stderr && !stderr.includes('warning')) {
          console.error(`⚠️  Warning: ${stderr}`);
        }
        console.log(`✅ ${step.name} completed`);
      } catch (error) {
        if (step.skipOnError) {
          console.warn(`⚠️  ${step.name} failed (non-critical): ${error.message}`);
        } else {
          console.error(`❌ ${step.name} failed:`, error.message);
          process.exit(1);
        }
      }
    }
    
    if (step.verify) {
      const success = await step.verify();
      if (!success) {
        console.error(`❌ ${step.name} verification failed`);
        process.exit(1);
      }
      console.log(`✅ ${step.name} verified`);
    }
  }
  
  console.log('\n🎉 Local build test completed successfully!');
}

async function verifyPlatformBuild(platform) {
  const buildOutputs = {
    mac: 'release-builds/mac/PasteFlow.app',
    win: 'release-builds/win-unpacked/PasteFlow.exe',
    linux: 'release-builds/PasteFlow.AppImage'
  };
  
  if (!platform || !buildOutputs[platform]) {
    console.error('❌ Invalid platform. Use: mac, win, or linux');
    process.exit(1);
  }
  
  const outputPath = path.join(process.cwd(), buildOutputs[platform]);
  
  try {
    await fs.access(outputPath);
    console.log(`✅ ${platform} build output verified: ${outputPath}`);
    
    const stats = await fs.stat(outputPath);
    const sizeMB = stats.size / (1024 * 1024);
    console.log(`   Size: ${sizeMB.toFixed(2)} MB`);
    
    if (sizeMB < 50 && !stats.isDirectory()) {
      console.warn(`⚠️  Build seems small (${sizeMB.toFixed(2)} MB), verify all assets are included`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ ${platform} build output not found: ${outputPath}`);
    return false;
  }
}

// Main execution
if (require.main === module) {
  const platform = process.argv[2];
  
  if (platform) {
    verifyPlatformBuild(platform);
  } else {
    testLocalBuild().catch(error => {
      console.error('Build test failed:', error);
      process.exit(1);
    });
  }
}

module.exports = { testLocalBuild, verifyPlatformBuild };