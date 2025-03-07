const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs").promises;
const path = require("path");
const prettier = require("prettier");

/**
 * Determines the appropriate Prettier parser based on file extension
 * @param {string} filePath Path to the file
 * @returns {string|null} Prettier parser name or null if no appropriate parser
 */
function getPrettierParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
      return "babel";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".css":
      return "css";
    case ".json":
      return "json";
    case ".html":
      return "html";
    case ".xml":
      return "xml";
    case ".md":
      return "markdown";
    default:
      return null;
  }
}

/**
 * Parse XML string containing file changes
 * @param {string} xmlString XML string from o1 model
 * @returns {Promise<Array<{file_summary: string, file_operation: string, file_path: string, file_code?: string}> | null>} Array of parsed file changes or null if parsing fails
 */
async function parseXmlString(xmlString) {
  try {
    // Check for empty or null input
    if (!xmlString || !xmlString.trim()) {
      throw new Error("Empty or null XML input");
    }
    
    console.log("Original XML length:", xmlString.length);
    console.log("XML input excerpt:", xmlString.substring(0, 200));
    
    // Detect problematic JSX/React patterns
    if (containsProblematicJsx(xmlString)) {
      console.log("Detected problematic JSX/React patterns in XML input - preprocessing required");
    }
    
    // Pre-process the XML string to handle potential JSX/TSX code
    xmlString = preprocessXml(xmlString);
    console.log("Preprocessed XML length:", xmlString.length);
    
    // Always wrap file_code in CDATA
    xmlString = prepareXmlWithCdata(xmlString);
    console.log("XML with CDATA sections length:", xmlString.length);
    console.log("XML after CDATA wrapping excerpt:", xmlString.substring(0, 200)); // Log first 200 chars
    
    // Look for CDATA sections - if none are found after prepareXmlWithCdata, something is wrong
    if (!xmlString.includes('<![CDATA[')) {
      console.warn("No CDATA sections found after preprocessing - this may cause XML parsing errors");
    }
    
    let errorLog = [];
    let warningLog = [];
    let fatalErrorMessage = null;
    
    // Create a parser with the newer callback-based error handling
    const parser = new DOMParser({
      locator: {},
      onError: (msg) => {
        console.error("XML Error:", msg);
        errorLog.push(msg);
      },
      onWarning: (msg) => {
        console.warn("XML Warning:", msg);
        warningLog.push(msg);
      },
      onFatalError: function(msg) {
        console.error("XML Fatal Error:", msg);
        fatalErrorMessage = msg;
        throw new Error(`Fatal XML Error: ${msg}`);
      }
    });
    
    // Parse the XML
    let doc;
    try {
      doc = parser.parseFromString(xmlString, "text/xml");
      
      // Check for parsing errors in the document itself
      const parserErrors = doc.getElementsByTagName('parsererror');
      if (parserErrors.length > 0) {
        const errorText = parserErrors[0].textContent || "Unknown parser error";
        console.error("XML parsing error detected in document:", errorText);
        
        // Try to provide context about the error
        const problemArea = findProblemArea(xmlString, errorText);
        if (problemArea) {
          throw new Error(`XML parsing failed: ${errorText}\n\nProblem area:\n${problemArea}\n\nTry using the Format XML button to fix JSX syntax issues.`);
        } else {
          throw new Error(`XML parsing failed: ${errorText}\n\nTry using the Format XML button to fix JSX syntax issues.`);
        }
      }
    } catch (parseError) {
      console.error("XML parsing failed:", parseError);
      
      // Log accumulated errors and warnings
      if (errorLog.length > 0) {
        console.error("All XML errors:", errorLog);
      }
      
      if (warningLog.length > 0) {
        console.warn("All XML warnings:", warningLog);
      }
      
      // Try to provide more context about the problem area
      if (parseError.message) {
        const problemArea = findProblemArea(xmlString, parseError.message);
        if (problemArea) {
          throw new Error(`XML parsing failed: ${parseError.message}\n\nProblem area:\n${problemArea}\n\nTry using the Format XML button to fix JSX syntax issues.`);
        }
      }
      
      throw parseError;
    }
    
    // Check for parsing errors
    const parserError = doc.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      const errorMessage = parserError[0].textContent || "Unknown parsing error";
      console.error("XML parsing error detected:", errorMessage);
      throw new Error(`XML parsing failed: ${errorMessage}`);
    }
    
    // Find the changed_files element
    const changedFilesElements = doc.getElementsByTagName('changed_files');
    if (!changedFilesElements || changedFilesElements.length === 0) {
      throw new Error("No <changed_files> element found in the XML");
    }
    
    const changedFiles = changedFilesElements[0];
    const fileElements = changedFiles.getElementsByTagName('file');
    
    if (!fileElements || fileElements.length === 0) {
      throw new Error("No <file> elements found in <changed_files>");
    }
    
    // Process each file element
    const changes = [];
    for (let i = 0; i < fileElements.length; i++) {
      const fileElement = fileElements[i];
      
      // Extract file information
      const filePathElements = fileElement.getElementsByTagName('file_path');
      if (!filePathElements || filePathElements.length === 0) {
        console.warn(`Missing file_path for file element at index ${i}`);
        continue;
      }
      
      const filePath = filePathElements[0].textContent;
      if (!filePath) {
        console.warn(`Empty file_path for file element at index ${i}`);
        continue;
      }
      
      const fileOperationElements = fileElement.getElementsByTagName('file_operation');
      if (!fileOperationElements || fileOperationElements.length === 0) {
        console.warn(`Missing file_operation for file: ${filePath}`);
        continue;
      }
      
      const fileOperation = fileOperationElements[0].textContent;
      if (!fileOperation) {
        console.warn(`Empty file_operation for file: ${filePath}`);
        continue;
      }
      
      // Extract summary (optional)
      const fileSummaryElements = fileElement.getElementsByTagName('file_summary');
      const fileSummary = fileSummaryElements && fileSummaryElements.length > 0 
        ? fileSummaryElements[0].textContent || ""
        : "";
      
      // Extract code (required for CREATE/UPDATE)
      let fileCode = null;
      
      if (fileOperation.toUpperCase() !== 'DELETE') {
        const fileCodeElements = fileElement.getElementsByTagName('file_code');
        if (!fileCodeElements || fileCodeElements.length === 0) {
          console.warn(`Missing file_code for non-DELETE operation on file: ${filePath}`);
          continue;
        }
        
        // Get the raw XML content of the file_code element to preserve CDATA
        const fileCodeElement = fileCodeElements[0];
        
        // Check if there's a CDATA section
        const cdataNode = Array.from(fileCodeElement.childNodes).find(
          node => node.nodeType === 4 // CDATA_SECTION_NODE
        );
        
        if (cdataNode) {
          fileCode = cdataNode.data;
          console.log(`Found CDATA for ${filePath}, length: ${fileCode.length}`);
        } else {
          // If no CDATA, use textContent but be aware it might have been parsed
          fileCode = fileCodeElement.textContent || "";
          console.warn(`No CDATA found for ${filePath}, using textContent, length: ${fileCode.length}`);
        }
        
        console.log(`Extracted file_code excerpt for ${filePath}:`, fileCode.substring(0, 100));
        
        // Note: We're no longer applying string replacements to preserve exact syntax including backticks
        // Let Prettier handle formatting later in applyFileChanges
      }
      
      changes.push({
        file_summary: fileSummary,
        file_operation: fileOperation,
        file_path: filePath,
        file_code: fileCode
      });
    }
    
    console.log(`Found ${changes.length} file changes to apply`);
    return changes;
  } catch (error) {
    console.error("Error in parseXmlString:", error);
    throw error;
  }
}

/**
 * Preprocesses XML string to handle common issues with code blocks
 * @param {string} xmlString The raw XML string
 * @returns {string} Processed XML string
 */
function preprocessXml(xmlString) {
  // First attempt: fix common issues with string template literals in JSX/TSX
  let processedXml = xmlString;
  
  // Fix missing quotes around template literals in attributes
  processedXml = processedXml.replace(/className=\{([^{}]+)\}/g, 'className="{$1}"');
  processedXml = processedXml.replace(/style=\{([^{}]+)\}/g, 'style="{$1}"');
  
  // Check if there are still issues
  if (containsProblematicJsx(processedXml)) {
    // Wrap file_code content in CDATA if needed
    return wrapFileCodeInCData(processedXml);
  }
  
  return processedXml;
}

/**
 * Checks if the XML contains problematic JSX patterns that would break XML parsing
 * @param {string} xmlString The XML string to check
 * @returns {boolean} True if problematic patterns are found
 */
function containsProblematicJsx(xmlString) {
  // Common JSX/TSX patterns that can cause XML parsing issues
  const problematicPatterns = [
    /className=\{[^{}'"]*\}/g,  // className={value} without quotes
    /style=\{[^{}'"]*\}/g,      // style={value} without quotes
    /<[A-Za-z]+\s+[^>]*=[^>'"]*>/g, // Attributes without quotes
    /\{[^{}]*\}/g,              // Any curly braces expressions (React code)
    /<[A-Za-z][\w.-]*\s+[^>]*\/>/g, // Self-closing tags like <Component />
    // Look for lines with unexpected content that might be comments not properly formed
    /[A-Za-z]+\s+\/\//g,         // Words followed by // like "Copy //"
    // Template literals with ${} interpolation
    /`[^`]*\${[^`]*}`/g,        // Template literal with interpolation
    // Nested JSX components
    /<[A-Za-z][\w.-]*\s*>\s*<[A-Za-z][\w.-]*/g, // Nested opening tags like <Outer><Inner
    // JSX fragments
    /<>\s*<[A-Za-z][\w.-]*/g,   // JSX fragment opening
    /<\/>\s*$/g,                // JSX fragment closing
    // Multiple attributes on JSX elements
    /<[A-Za-z][\w.-]*\s+[^>]*\s+[^>]*\s+[^>]*>/g, // Elements with multiple attributes
    // Inline comments within JSX
    /\/\/[^\n]*/g,              // Single-line comments
    /\/\*[\s\S]*?\*\//g         // Multi-line comments
  ];

  return problematicPatterns.some(pattern => pattern.test(xmlString));
}

/**
 * Apply file changes from parsed XML
 * @param {object} change File change object
 * @param {string} change.file_operation Operation type (CREATE, UPDATE, DELETE)
 * @param {string} change.file_path Path to the file relative to project directory
 * @param {string} [change.file_code] File content (required for CREATE and UPDATE)
 * @param {string} projectDirectory Target directory path
 * @returns {Promise<void>}
 */
async function applyFileChanges(change, projectDirectory) {
  if (!change || !change.file_path) {
    throw new Error("Invalid change object: missing required file_path");
  }

  // Sanitize file path to prevent directory traversal attacks
  const relativePath = change.file_path.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
  if (relativePath !== change.file_path) {
    console.warn(`Attempted directory traversal in path: ${change.file_path}. Using sanitized path: ${relativePath}`);
  }
  
  const fullPath = path.join(projectDirectory, relativePath);
  console.log(`Resolved full path: ${fullPath}`);
  
  try {
    console.log(`Applying ${change.file_operation} operation to ${relativePath} (full path: ${fullPath})`);
    
    // Check project directory permissions explicitly
    try {
      await fs.access(projectDirectory, fs.constants.F_OK | fs.constants.W_OK);
      console.log(`Project directory ${projectDirectory} is writable`);
    } catch (accessError) {
      if (accessError.code === 'ENOENT') {
        throw new Error(`Project directory does not exist: ${projectDirectory}`);
      } else if (accessError.code === 'EACCES') {
        throw new Error(`Permission denied to access project directory: ${projectDirectory}`);
      } else {
        throw new Error(`Error accessing project directory: ${accessError.message}`);
      }
    }

    switch (change.file_operation.toUpperCase()) {
      case "CREATE":
      case "UPDATE":
        if (!change.file_code) {
          throw new Error(`Missing file_code for ${change.file_operation} operation on ${relativePath}`);
        }
        
        // Format the code with Prettier if applicable
        const parser = getPrettierParser(change.file_path);
        if (parser) {
          try {
            const config = await prettier.resolveConfig(fullPath);
            const formatOptions = config ? { ...config, parser: parser } : { parser: parser };
            change.file_code = prettier.format(change.file_code, formatOptions);
            console.log(`Formatted ${change.file_path} with Prettier using ${parser} parser and ${config ? 'project' : 'default'} config`);
          } catch (error) {
            console.warn(`Failed to format ${change.file_path} with Prettier: ${error.message}`);
            // Proceed with original code if formatting fails
          }
        }
        
        // For UPDATE, explicitly verify the file exists and is writable
        if (change.file_operation.toUpperCase() === "UPDATE") {
          try {
            await fs.access(fullPath, fs.constants.F_OK | fs.constants.W_OK);
            console.log(`File exists and is writable: ${fullPath}`);
          } catch (error) {
            if (error.code === 'ENOENT') {
              throw new Error(`File does not exist: ${fullPath}. Cannot update non-existent file.`);
            } else if (error.code === 'EACCES') {
              throw new Error(`Permission denied: Cannot write to ${fullPath}`);
            } else {
              throw new Error(`File access error: ${error.message}`);
            }
          }
        }
        
        // Ensure directory exists
        const dirPath = path.dirname(fullPath);
        console.log(`Ensuring directory exists: ${dirPath}`);
        await fs.mkdir(dirPath, { recursive: true });
        
        // Capture original content for hash comparison
        let originalHash = '';
        if (change.file_operation.toUpperCase() === "UPDATE") {
          try {
            const originalContent = await fs.readFile(fullPath, 'utf8');
            const crypto = require('crypto');
            originalHash = crypto.createHash('md5').update(originalContent).digest('hex');
            const newHash = crypto.createHash('md5').update(change.file_code).digest('hex');
            console.log(`Original content hash: ${originalHash}`);
            console.log(`New content hash: ${newHash}`);
            
            if (originalHash === newHash) {
              console.warn(`Content is identical - no actual change needed for ${fullPath}`);
            }
          } catch (error) {
            console.warn(`Could not read original file: ${error.message}`);
          }
        }
        
        // Write file with explicit length logging
        console.log(`Writing to ${fullPath}, content length: ${change.file_code.length}`);
        await fs.writeFile(fullPath, change.file_code, "utf8");
        
        // Verify write was successful
        try {
          const writtenContent = await fs.readFile(fullPath, 'utf8');
          console.log(`Verification: read ${writtenContent.length} bytes from ${fullPath}`);
          
          // Verify content integrity with hash comparison
          const crypto = require('crypto');
          const writtenHash = crypto.createHash('md5').update(writtenContent).digest('hex');
          const expectedHash = crypto.createHash('md5').update(change.file_code).digest('hex');
          
          if (writtenHash !== expectedHash) {
            console.error(`Write verification failed: content hash mismatch`);
            throw new Error(`Failed to write correct content to ${fullPath}`);
          }
          
          if (change.file_operation.toUpperCase() === "UPDATE" && originalHash === writtenHash && originalHash !== '') {
            console.warn(`File content unchanged after update operation for ${fullPath}`);
          }
          
          console.log(`Successfully ${change.file_operation.toUpperCase() === 'CREATE' ? 'created' : 'updated'} file: ${fullPath}`);
        } catch (verifyError) {
          if (verifyError.code === 'ENOENT') {
            throw new Error(`Verification failed: ${fullPath} not found after write`);
          }
          throw new Error(`Write verification failed: ${verifyError.message}`);
        }
        break;
        
      case "DELETE":
        try {
          await fs.access(fullPath);
          console.log(`Deleting file: ${fullPath}`);
          await fs.rm(fullPath, { force: true });
          
          // Verify deletion
          try {
            await fs.access(fullPath);
            throw new Error(`File still exists after deletion: ${fullPath}`);
          } catch (accessError) {
            if (accessError.code === 'ENOENT') {
              console.log(`Successfully deleted file: ${fullPath}`);
            } else {
              throw accessError;
            }
          }
        } catch (error) {
          if (error.code === 'ENOENT') {
            console.warn(`File ${fullPath} does not exist for DELETE operation`);
          } else {
            throw error;
          }
        }
        break;
        
      default:
        throw new Error(`Unsupported file operation: ${change.file_operation}`);
    }
  } catch (error) {
    console.error(`Error applying ${change.file_operation} to ${relativePath}:`, error);
    
    // Provide clearer error message based on error code
    let errorMessage = error.message;
    if (error.code === 'ENOENT') {
      errorMessage = `Path not found: ${error.path || fullPath}`;
    } else if (error.code === 'EACCES') {
      errorMessage = `Permission denied: Cannot access ${error.path || fullPath}`;
    } else if (error.code === 'EISDIR') {
      errorMessage = `Cannot write to directory: ${error.path || fullPath}`;
    }
    
    throw new Error(`Failed to ${change.file_operation.toLowerCase()} file ${relativePath}: ${errorMessage}`);
  }
}

/**
 * Prepare a raw XML string with proper CDATA sections for JSX/React code
 * @param {string} xmlString The raw XML string from a model or user
 * @returns {string} XML string with proper CDATA sections
 */
function prepareXmlWithCdata(xmlString) {
  console.log("Preparing XML with CDATA...");
  console.log("Original XML length:", xmlString.length);
  console.log("Original XML excerpt:", xmlString.substring(0, 200));
  
  // Count original CDATA sections
  const originalCdataCount = (xmlString.match(/<!\[CDATA\[/g) || []).length;
  console.log(`Original XML contains ${originalCdataCount} CDATA sections`);
  
  // Count file_code tags to track wrapping success
  const fileCodeCount = (xmlString.match(/<file_code>/g) || []).length;
  console.log(`Found ${fileCodeCount} <file_code> tags to process`);
  
  // Track how many sections we actually wrapped
  let wrappedCount = 0;
  
  // Always wrap file_code content in CDATA to protect JSX/React code
  const processedXml = xmlString.replace(
    /<file_code>([\s\S]*?)<\/file_code>/g,
    (match, p1) => {
      // Check if already wrapped to avoid double-wrapping
      if (p1.trim().startsWith('<![CDATA[')) {
        console.log("CDATA already present in <file_code>, skipping wrapping.");
        return match;
      }
      wrappedCount++;
      console.log(`Wrapping content #${wrappedCount} in CDATA, excerpt:`, p1.substring(0, 100));
      return `<file_code><![CDATA[${p1}]]></file_code>`;
    }
  );
  
  // Verify CDATA sections exist after processing
  const finalCdataCount = (processedXml.match(/<!\[CDATA\[/g) || []).length;
  console.log(`Found ${finalCdataCount} CDATA sections after processing (wrapped ${wrappedCount} new sections)`);
  
  // Verify the length has changed if we wrapped any sections
  console.log("Processed XML length:", processedXml.length);
  if (wrappedCount > 0 && processedXml.length <= xmlString.length) {
    console.warn("Warning: Processed XML should be longer after adding CDATA sections, but length didn't increase");
  }
  console.log("Processed XML excerpt:", processedXml.substring(0, 200));
  
  return processedXml;
}

/**
 * Wraps file_code content in CDATA sections to protect JSX/TSX from XML parsing
 * @param {string} xmlString - The XML string to process
 * @returns {string} - The processed XML with CDATA sections added
 */
function wrapFileCodeInCData(xmlString) {
  // Find all file_code blocks and wrap their content in CDATA sections if not already
  return xmlString.replace(
    /<file_code>((?!\s*<!\[CDATA\[)[\s\S]*?)<\/file_code>/g,
    (match, content) => `<file_code><![CDATA[${content}]]></file_code>`
  );
}

/**
 * Find the problematic area in the XML string based on error message
 * @param {string} xmlString The XML string
 * @param {string} errorMessage The error message from the parser
 * @returns {string} A snippet of the XML around the problematic area
 */
function findProblemArea(xmlString, errorMessage) {
  // Default context size (characters before and after the problem)
  const contextSize = 100;
  
  if (!errorMessage || typeof errorMessage !== 'string') {
    return `Unable to identify problem area without error message`;
  }
  
  // Common error patterns to extract line/column information
  const patterns = [
    // Standard @#[line:X,col:Y] format
    /@#\[line:(\d+),col:(\d+)\]/,
    // Line X, column Y format
    /[Ll]ine\s+(\d+)(?:\s*,\s*|[,:]|\s+at\s+)[Cc]ol(?:umn)?\s*(\d+)/,
    // At line X, column Y format
    /[Aa]t\s+line\s+(\d+)(?:\s*,\s*|[,:]|\s+)[Cc]ol(?:umn)?\s*(\d+)/,
    // Error on line X at position Y
    /[Ee]rror\s+on\s+line\s+(\d+)(?:\s*at\s+position\s+|\s+pos\s+|:)(\d+)/
  ];
  
  // Try each pattern to extract line and column
  let lineNum = null;
  let colNum = null;
  
  for (const pattern of patterns) {
    const match = errorMessage.match(pattern);
    if (match) {
      lineNum = parseInt(match[1], 10);
      colNum = parseInt(match[2], 10);
      break;
    }
  }
  
  // If we found line and column information
  if (lineNum !== null && colNum !== null) {
    // Split XML into lines
    const lines = xmlString.split('\n');
    
    // Ensure line number is within bounds
    if (lineNum > lines.length) {
      return `Line number ${lineNum} exceeds document length (${lines.length} lines)`;
    }
    
    // Get problem line and surrounding context
    const startLine = Math.max(0, lineNum - 3);
    const endLine = Math.min(lines.length, lineNum + 3);
    
    // Build context with line numbers
    let contextLines = [];
    contextLines.push(`Error at line ${lineNum}, column ${colNum}:`);
    contextLines.push('');
    
    for (let i = startLine; i < endLine; i++) {
      const lineIndex = i + 1; // 1-based line numbers
      const lineIndicator = lineIndex === lineNum ? '> ' : '  ';
      const lineContent = lines[i] || '';
      contextLines.push(`${lineIndicator}${lineIndex}: ${lineContent}`);
      
      // Add pointer to the specific column if this is the problem line
      if (lineIndex === lineNum) {
        // Calculate pointer position, accounting for line indicator and line number
        const pointerIndent = lineIndicator.length + String(lineIndex).length + 2;
        // Ensure column number is within bounds
        const safeColNum = Math.min(colNum, lineContent.length + 1);
        const pointer = ' '.repeat(pointerIndent + safeColNum - 1) + '^';
        contextLines.push(pointer);
      }
    }
    
    return contextLines.join('\n');
  }
  
  // Try to identify common XML issues by looking for specific patterns in the error message
  const xmlIssuePatterns = [
    {
      pattern: /tag mismatch|mismatched tag|not terminated by/i,
      findFn: () => findUnclosedTags(xmlString)
    },
    {
      pattern: /unclosed token|unterminated string|unexpected token/i,
      findFn: () => findUnclosedTokens(xmlString)
    },
    {
      pattern: /unexpected character|invalid character/i,
      findFn: () => findProblemCharacters(xmlString)
    }
  ];
  
  for (const { pattern, findFn } of xmlIssuePatterns) {
    if (pattern.test(errorMessage)) {
      const result = findFn();
      if (result) return result;
    }
  }
  
  // Look for specific structures that might be problematic
  
  // Check for unclosed CDATA section
  const cdataStart = xmlString.lastIndexOf('<![CDATA[');
  if (cdataStart !== -1) {
    const cdataEnd = xmlString.indexOf(']]>', cdataStart);
    if (cdataEnd === -1) {
      // Unclosed CDATA section found
      const start = Math.max(0, cdataStart - contextSize);
      const end = Math.min(xmlString.length, cdataStart + contextSize);
      return `Unclosed CDATA section:\n${xmlString.substring(start, end)}`;
    }
  }
  
  // Look for unclosed file_code tag
  const fileCodeStart = xmlString.lastIndexOf('<file_code>');
  if (fileCodeStart !== -1) {
    const fileCodeEnd = xmlString.indexOf('</file_code>', fileCodeStart);
    if (fileCodeEnd === -1) {
      // Unclosed file_code tag
      const start = Math.max(0, fileCodeStart - contextSize);
      const end = Math.min(xmlString.length, fileCodeStart + contextSize);
      return `Unclosed file_code tag:\n${xmlString.substring(start, end)}`;
    }
  }
  
  // Look for problematic JSX patterns
  const jsxPatterns = [
    { pattern: /className=\{[^{}'"]*\}/g, message: "Unquoted className JSX attribute" },
    { pattern: /style=\{[^{}'"]*\}/g, message: "Unquoted style JSX attribute" },
    { pattern: /\${[^}]*}/g, message: "Template literal interpolation" },
    { pattern: /[A-Za-z]+\s+\/\//g, message: "Possible comment parsing issue" }
  ];
  
  for (const { pattern, message } of jsxPatterns) {
    const match = xmlString.match(pattern);
    if (match) {
      const matchPos = xmlString.indexOf(match[0]);
      const start = Math.max(0, matchPos - contextSize);
      const end = Math.min(xmlString.length, matchPos + match[0].length + contextSize);
      return `${message} found:\n${xmlString.substring(start, end)}`;
    }
  }
  
  // No specific issue found, just return a chunk from the middle with a generic message
  const middleIndex = Math.floor(xmlString.length / 2);
  const start = Math.max(0, middleIndex - contextSize);
  const end = Math.min(xmlString.length, middleIndex + contextSize);
  return `Could not identify specific issue. XML parsing error near:\n${xmlString.substring(start, end)}`;
}

/**
 * Helper function to find unclosed XML tags
 * @param {string} xmlString The XML string
 * @returns {string|null} Description of problem or null if not found
 */
function findUnclosedTags(xmlString) {
  const contextSize = 50;
  const openTagsStack = [];
  const xmlPattern = /<\/?([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s+[^>]*)?>/g;
  let match;
  
  while ((match = xmlPattern.exec(xmlString)) !== null) {
    const tagContent = match[0];
    const tagName = match[1];
    
    if (tagContent.startsWith('</')) {
      // Closing tag
      if (openTagsStack.length === 0 || openTagsStack[openTagsStack.length - 1] !== tagName) {
        // Mismatched closing tag
        const start = Math.max(0, match.index - contextSize);
        const end = Math.min(xmlString.length, match.index + tagContent.length + contextSize);
        return `Mismatched closing tag </${tagName}>:\n${xmlString.substring(start, end)}`;
      }
      openTagsStack.pop();
    } else if (!tagContent.endsWith('/>')) {
      // Opening tag (not self-closing)
      openTagsStack.push(tagName);
    }
  }
  
  // Check if there are unclosed tags
  if (openTagsStack.length > 0) {
    const lastTag = openTagsStack[openTagsStack.length - 1];
    const lastTagPos = xmlString.lastIndexOf(`<${lastTag}`);
    
    if (lastTagPos !== -1) {
      const start = Math.max(0, lastTagPos - contextSize);
      const end = Math.min(xmlString.length, lastTagPos + contextSize);
      return `Unclosed tag <${lastTag}>:\n${xmlString.substring(start, end)}`;
    }
  }
  
  return null;
}

/**
 * Helper function to find unclosed tokens like quotes or braces
 * @param {string} xmlString The XML string
 * @returns {string|null} Description of problem or null if not found
 */
function findUnclosedTokens(xmlString) {
  const contextSize = 50;
  const tokenPairs = [
    { open: '"', close: '"', name: 'double quote' },
    { open: "'", close: "'", name: 'single quote' },
    { open: '{', close: '}', name: 'curly brace' },
    { open: '[', close: ']', name: 'square bracket' },
    { open: '(', close: ')', name: 'parenthesis' }
  ];
  
  for (const { open, close, name } of tokenPairs) {
    // Count occurrences
    const openCount = (xmlString.match(new RegExp(`\\${open}`, 'g')) || []).length;
    const closeCount = (xmlString.match(new RegExp(`\\${close}`, 'g')) || []).length;
    
    if (openCount !== closeCount) {
      // Find the last unclosed token
      let stack = 0;
      let lastUnmatchedPos = -1;
      
      for (let i = 0; i < xmlString.length; i++) {
        if (xmlString[i] === open) {
          stack++;
          lastUnmatchedPos = i;
        } else if (xmlString[i] === close) {
          stack--;
          if (stack < 0) {
            // Extra closing token
            const start = Math.max(0, i - contextSize);
            const end = Math.min(xmlString.length, i + contextSize);
            return `Unexpected ${name} at position ${i}:\n${xmlString.substring(start, end)}`;
          }
        }
      }
      
      if (stack > 0 && lastUnmatchedPos !== -1) {
        // Unclosed token
        const start = Math.max(0, lastUnmatchedPos - contextSize);
        const end = Math.min(xmlString.length, lastUnmatchedPos + contextSize);
        return `Unclosed ${name} at position ${lastUnmatchedPos}:\n${xmlString.substring(start, end)}`;
      }
    }
  }
  
  return null;
}

/**
 * Helper function to find problematic characters that might break XML parsing
 * @param {string} xmlString The XML string
 * @returns {string|null} Description of problem or null if not found
 */
function findProblemCharacters(xmlString) {
  const contextSize = 50;
  const problemChars = [
    { pattern: /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, name: 'unescaped ampersand (&)' },
    { pattern: /</g, name: 'unescaped less-than (<)', exclusion: /<[a-zA-Z\/!?]/ },
    { pattern: />/g, name: 'unescaped greater-than (>)', exclusion: /[a-zA-Z\/'"]\s*>/ },
    { pattern: /\uFFFD/g, name: 'Unicode replacement character' }
  ];
  
  for (const { pattern, name, exclusion } of problemChars) {
    pattern.lastIndex = 0; // Reset regex state
    
    const matches = [];
    let match;
    
    while ((match = pattern.exec(xmlString)) !== null) {
      // Check if this match is excluded
      if (exclusion) {
        const contextStart = Math.max(0, match.index - 10);
        const contextEnd = Math.min(xmlString.length, match.index + 10);
        const context = xmlString.substring(contextStart, contextEnd);
        
        if (exclusion.test(context)) {
          continue; // Skip this match
        }
      }
      
      matches.push(match.index);
    }
    
    if (matches.length > 0) {
      // Use the first problematic character
      const pos = matches[0];
      const start = Math.max(0, pos - contextSize);
      const end = Math.min(xmlString.length, pos + contextSize);
      return `Found ${name} that might break XML parsing at position ${pos}:\n${xmlString.substring(start, end)}`;
    }
  }
  
  return null;
}

module.exports = {
  parseXmlString,
  applyFileChanges,
  prepareXmlWithCdata
}; 