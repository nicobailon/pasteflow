#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

// Import the excluded files list
const { excludedFiles } = require('./excluded-files.js');

// Function to parse .gitignore file if it exists
function loadGitignore(rootDir, userExclusionPatterns = []) {
  const ig = ignore();
  const gitignorePath = path.join(rootDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    ig.add(gitignoreContent);
  }

  // Add some default ignores that are common
  ig.add([".git", "node_modules", ".DS_Store"]);

  // Add the excludedFiles patterns for gitignore-based exclusion
  ig.add(excludedFiles);

  // Add user-defined exclusion patterns
  if (userExclusionPatterns && userExclusionPatterns.length > 0) {
    ig.add(userExclusionPatterns);
  }

  return ig;
}

// Function to scan directory and build file list
function scanDirectory(rootDir, ignoreFilter) {
  const allFiles = [];
  const directoryQueue = [{ path: rootDir, depth: 0 }];
  const processedDirs = new Set();

  while (directoryQueue.length > 0) {
    const { path: dirPath, depth } = directoryQueue.shift();
    
    if (processedDirs.has(dirPath)) continue;
    if (depth > 10) continue; // Prevent infinite recursion
    
    processedDirs.add(dirPath);
    
    try {
      const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const dirent of dirents) {
        const fullPath = path.join(dirPath, dirent.name);
        const relativePath = path.relative(rootDir, fullPath);
        
        console.log(`Checking: ${relativePath}`);
        
        if (ignoreFilter.ignores(relativePath)) {
          console.log(`  -> IGNORED by filter`);
          continue;
        }
        
        if (dirent.isDirectory()) {
          console.log(`  -> DIRECTORY: Adding to queue`);
          directoryQueue.push({ path: fullPath, depth: depth + 1 });
        } else if (dirent.isFile()) {
          console.log(`  -> FILE: Adding to results`);
          allFiles.push({
            name: dirent.name,
            path: fullPath,
            relativePath: relativePath,
            isDirectory: false
          });
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error.message);
    }
  }

  return allFiles;
}

// Simulate the tree builder worker logic
function simulateTreeBuilder(allFiles, selectedFolder) {
  console.log('\nSimulating tree builder logic:');
  console.log('-'.repeat(40));

  // Normalize path for consistent comparison
  function normalizePath(path) {
    return path.replace(/\\/g, '/').replace(/\/$/, '');
  }

  const fileMap = {};

  for (const file of allFiles) {
    if (!file.path) continue;

    const normalizedFilePath = normalizePath(file.path);
    const normalizedRootPath = selectedFolder ? normalizePath(selectedFolder) : '';

    // Calculate relative path
    let relativePath;
    if (selectedFolder) {
      const root = normalizedRootPath;
      const underRoot = normalizedFilePath === root || normalizedFilePath.startsWith(root + '/');
      if (!underRoot) {
        continue;
      }
      relativePath = normalizedFilePath === root ? '' : normalizedFilePath.slice(root.length + 1);
    } else {
      relativePath = normalizedFilePath.replace(/^\/|^\\/, '');
    }

    console.log(`Processing file: ${file.path} -> relativePath: ${relativePath}`);

    const parts = relativePath.split('/');
    let currentPath = "";
    let current = fileMap;

    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (!part) continue;

      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (j < parts.length - 1) {
        // Directory
        const dirPath = selectedFolder
          ? normalizePath(`${normalizedRootPath}/${currentPath}`)
          : normalizePath(`/${currentPath}`);

        console.log(`  Creating directory: ${part} at path: ${dirPath}`);

        if (!current[part]) {
          current[part] = {
            name: part,
            path: dirPath,
            children: {},
            isDirectory: true,
            isExpanded: j < 2
          };
        }

        if (!current[part].children) {
          current[part].children = {};
        }

        current = current[part].children;
      } else {
        // File
        const filePath = selectedFolder
          ? normalizePath(`${normalizedRootPath}/${currentPath}`)
          : normalizePath(`/${currentPath}`);

        console.log(`  Creating file: ${part} at path: ${filePath}`);

        current[part] = {
          name: part,
          path: filePath,
          isFile: true,
          fileData: file
        };
      }
    }
  }

  return fileMap;
}

// Convert tree map to flat array (like the worker does)
function convertToTreeNodes(nodeMap, level = 0) {
  const nodes = [];

  for (const key in nodeMap) {
    const node = nodeMap[key];

    if (node.isFile) {
      nodes.push({
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'file',
        level,
        fileData: node.fileData
      });
    } else if (node.isDirectory) {
      const treeNode = {
        id: node.path,
        name: node.name,
        path: node.path,
        type: 'directory',
        level,
        isExpanded: node.isExpanded ?? false
      };

      if (node.children && Object.keys(node.children).length > 0) {
        treeNode.children = convertToTreeNodes(node.children, level + 1);
      }

      nodes.push(treeNode);
    }
  }

  // Sort: directories first, then files
  nodes.sort((a, b) => {
    if (a.type === 'directory' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// Test the file scanning logic
function testFileScanning() {
  const rootDir = process.cwd();
  console.log(`Testing file scanning in: ${rootDir}`);
  console.log('='.repeat(60));

  const ignoreFilter = loadGitignore(rootDir);

  // Test specific paths
  const testPaths = [
    'src/main/handlers',
    'src/main/handlers/state-handlers.ts',
    'src/main/db',
    'src/main/ipc',
    'src/main/utils'
  ];

  console.log('\nTesting specific paths:');
  console.log('-'.repeat(30));

  for (const testPath of testPaths) {
    const isIgnored = ignoreFilter.ignores(testPath);
    console.log(`${testPath}: ${isIgnored ? 'IGNORED' : 'INCLUDED'}`);
  }

  console.log('\nScanning src/main directory:');
  console.log('-'.repeat(30));

  const srcMainPath = path.join(rootDir, 'src', 'main');
  if (fs.existsSync(srcMainPath)) {
    const files = scanDirectory(srcMainPath, ignoreFilter);

    console.log('\nResults:');
    console.log('-'.repeat(30));
    console.log(`Found ${files.length} files`);

    // Group by directory
    const byDirectory = {};
    files.forEach(file => {
      const dir = path.dirname(file.relativePath);
      if (!byDirectory[dir]) byDirectory[dir] = [];
      byDirectory[dir].push(file.name);
    });

    Object.keys(byDirectory).sort().forEach(dir => {
      console.log(`\n${dir}/:`);
      byDirectory[dir].forEach(file => {
        console.log(`  - ${file}`);
      });
    });

    // Check specifically for handlers directory
    const handlersFiles = files.filter(f => f.relativePath.startsWith('handlers'));
    console.log(`\nHandlers directory files: ${handlersFiles.length}`);
    handlersFiles.forEach(f => {
      console.log(`  - ${f.relativePath}`);
    });

    // Now simulate the tree builder
    const fileMap = simulateTreeBuilder(files, srcMainPath);
    const treeNodes = convertToTreeNodes(fileMap);

    console.log('\nTree structure:');
    console.log('-'.repeat(30));

    function printTree(nodes, indent = '') {
      for (const node of nodes) {
        console.log(`${indent}${node.type === 'directory' ? '📁' : '📄'} ${node.name} (${node.path})`);
        if (node.children && node.children.length > 0) {
          printTree(node.children, indent + '  ');
        }
      }
    }

    printTree(treeNodes);

    // Check if handlers directory is in the tree
    const handlersDir = treeNodes.find(n => n.name === 'handlers');
    console.log(`\nHandlers directory in tree: ${handlersDir ? 'YES' : 'NO'}`);
    if (handlersDir) {
      console.log(`  - Path: ${handlersDir.path}`);
      console.log(`  - Type: ${handlersDir.type}`);
      console.log(`  - Children: ${handlersDir.children ? handlersDir.children.length : 0}`);
    }

  } else {
    console.log('src/main directory not found');
  }
}

// Test with the full project directory (like the app would do)
function testFullProject() {
  console.log('\n' + '='.repeat(60));
  console.log('Testing with full project directory');
  console.log('='.repeat(60));

  const rootDir = process.cwd();
  const ignoreFilter = loadGitignore(rootDir);

  console.log('\nScanning full project directory:');
  console.log('-'.repeat(40));

  const files = scanDirectory(rootDir, ignoreFilter);

  // Filter to only src/main files
  const srcMainFiles = files.filter(f => f.relativePath.startsWith('src/main/'));

  console.log(`\nFound ${srcMainFiles.length} files in src/main/`);

  // Group by directory
  const byDirectory = {};
  srcMainFiles.forEach(file => {
    const dir = path.dirname(file.relativePath);
    if (!byDirectory[dir]) byDirectory[dir] = [];
    byDirectory[dir].push(file.name);
  });

  Object.keys(byDirectory).sort().forEach(dir => {
    console.log(`\n${dir}/:`);
    byDirectory[dir].forEach(file => {
      console.log(`  - ${file}`);
    });
  });

  // Now simulate the tree builder with the full project
  const fileMap = simulateTreeBuilder(srcMainFiles, rootDir);
  const treeNodes = convertToTreeNodes(fileMap);

  console.log('\nFull project tree structure (src/main only):');
  console.log('-'.repeat(50));

  function printTree(nodes, indent = '') {
    for (const node of nodes) {
      if (node.path.includes('src/main')) {
        console.log(`${indent}${node.type === 'directory' ? '📁' : '📄'} ${node.name} (level: ${node.level}, expanded: ${node.isExpanded})`);
        if (node.children && node.children.length > 0) {
          printTree(node.children, indent + '  ');
        }
      }
    }
  }

  printTree(treeNodes);

  // Check specifically for handlers
  function findNodeByName(nodes, name) {
    for (const node of nodes) {
      if (node.name === name) return node;
      if (node.children) {
        const found = findNodeByName(node.children, name);
        if (found) return found;
      }
    }
    return null;
  }

  const handlersNode = findNodeByName(treeNodes, 'handlers');
  console.log(`\nHandlers node found: ${handlersNode ? 'YES' : 'NO'}`);
  if (handlersNode) {
    console.log(`  - Name: ${handlersNode.name}`);
    console.log(`  - Path: ${handlersNode.path}`);
    console.log(`  - Type: ${handlersNode.type}`);
    console.log(`  - Level: ${handlersNode.level}`);
    console.log(`  - Expanded: ${handlersNode.isExpanded}`);
    console.log(`  - Children: ${handlersNode.children ? handlersNode.children.length : 0}`);
    if (handlersNode.children) {
      handlersNode.children.forEach(child => {
        console.log(`    - ${child.name} (${child.type})`);
      });
    }
  }
}

// Run the tests
testFileScanning();
testFullProject();
