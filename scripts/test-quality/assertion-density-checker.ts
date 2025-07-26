#!/usr/bin/env npx tsx

import { readFileSync } from 'fs';
import { glob } from 'glob';

interface AssertionViolation {
  file: string;
  testName: string;
  lineNumber: number;
  assertionCount: number;
}

function countAssertionsInTest(testContent: string): number {
  // Count expect() calls, toHaveBeenCalled, etc.
  const expectMatches = testContent.match(/expect\(/g) || [];
  const toHaveBeenMatches = testContent.match(/\.toHaveBeenCalled/g) || [];
  const toThrowMatches = testContent.match(/\.toThrow/g) || [];
  
  return expectMatches.length + toHaveBeenMatches.length + toThrowMatches.length;
}

function analyzeTestFile(filePath: string): AssertionViolation[] {
  const content = readFileSync(filePath, 'utf8');
  const violations: AssertionViolation[] = [];
  
  // Find all test blocks
  const testRegex = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s+)?\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\);/g;
  let match;
  
  while ((match = testRegex.exec(content)) !== null) {
    const testName = match[1];
    const testBody = match[2];
    const assertionCount = countAssertionsInTest(testBody);
    
    if (assertionCount < 2) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      violations.push({
        file: filePath.replace(process.cwd(), '.'),
        testName,
        lineNumber,
        assertionCount
      });
    }
  }
  
  return violations;
}

async function checkAssertionDensity() {
  const testFiles = glob.sync('src/__tests__/**/*.{ts,tsx}', { absolute: true });
  let allViolations: AssertionViolation[] = [];
  
  for (const file of testFiles) {
    const violations = analyzeTestFile(file);
    allViolations = [...allViolations, ...violations];
  }
  
  if (allViolations.length > 0) {
    console.error('❌ Assertion density violations found:');
    allViolations.forEach(v => {
      console.error(`\n${v.file}:${v.lineNumber}`);
      console.error(`  Test: "${v.testName}"`);
      console.error(`  Assertions: ${v.assertionCount} (minimum: 2)`);
    });
    process.exit(1);
  }
  
  console.log('✅ All tests meet assertion density requirements');
}

checkAssertionDensity().catch(console.error);