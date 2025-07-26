#!/usr/bin/env npx tsx

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

interface MockViolation {
  file: string;
  mockCount: number;
  mocks: string[];
}

function countMocksInFile(filePath: string): { count: number; mocks: string[] } {
  const content = readFileSync(filePath, 'utf8');
  
  // Find jest.mock() calls
  const mockMatches = content.match(/jest\.mock\(['"`][^'"`]+['"`]/g) || [];
  
  // Find other mock patterns
  const mockFnMatches = content.match(/const \w+ = jest\.fn\(\)/g) || [];
  const spyMatches = content.match(/jest\.spyOn\(/g) || [];
  
  const allMocks = [...mockMatches, ...mockFnMatches, ...spyMatches];
  
  return {
    count: allMocks.length,
    mocks: allMocks
  };
}

async function checkMockLimits() {
  const testFiles = glob.sync('src/__tests__/**/*.{ts,tsx}', { absolute: true });
  const violations: MockViolation[] = [];
  
  for (const file of testFiles) {
    const { count, mocks } = countMocksInFile(file);
    
    if (count > 3) {
      violations.push({
        file: file.replace(process.cwd(), '.'),
        mockCount: count,
        mocks
      });
    }
  }
  
  if (violations.length > 0) {
    console.error('❌ Mock limit violations found:');
    violations.forEach(v => {
      console.error(`\n${v.file}: ${v.mockCount} mocks (limit: 3)`);
      v.mocks.forEach(mock => console.error(`  - ${mock}`));
    });
    process.exit(1);
  }
  
  console.log('✅ All test files comply with 3-mock limit');
}

checkMockLimits().catch(console.error);