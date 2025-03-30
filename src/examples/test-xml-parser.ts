import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateChangesSummary, parseXmlChanges, validateXmlChanges } from '../utils/xml-parser';

/**
 * This script demonstrates how to use the XML parser to parse and validate XML changes.
 * It can be used to test the XML parser functionality without running the full application.
 */

// Get current file directory (ESM compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the test XML file
const testXmlPath = path.join(__dirname, 'test-xml-changes.xml');
const testXml = fs.readFileSync(testXmlPath, 'utf8');

// Validate the XML
console.log('Validating XML...');
const validationResult = validateXmlChanges(testXml);

if (!validationResult.isValid) {
  console.error('XML validation failed:', validationResult.error);
  throw new Error('XML validation failed');
}

console.log('XML is valid!');

// Parse the XML
console.log('\nParsing XML...');
const changes = parseXmlChanges(testXml);

// Generate a summary
const summary = generateChangesSummary(changes);
console.log('\nChanges Summary:');
console.log(summary);

// Print details of each change
console.log('\nDetailed Changes:');
for (const [index, change] of changes.entries()) {
  console.log(`\n[${index + 1}] ${change.operation}: ${change.path}`);
  console.log(`Summary: ${change.summary}`);
  
  if (change.operation !== 'DELETE') {
    const codePreview = change.code?.split('\n').slice(0, 3).join('\n') + '...';
    console.log(`Code Preview: ${codePreview}`);
  }
}

console.log('\nXML parsing test completed successfully!');

/**
 * To run this script:
 * 1. Make sure you have built the project (npm run build)
 * 2. Run: node dist/examples/test-xml-parser.js
 * 
 * Expected output:
 * - Validation result
 * - Summary of changes
 * - Details of each change
 */ 