import { DOMParser } from "@xmldom/xmldom";

interface ParsedFileChange {
  file_operation: string;
  file_path: string;
  file_code?: string;
}

export async function parseXmlString(xmlString: string): Promise<ParsedFileChange[] | null> {
  try {
    // Find the XML content within markdown code blocks if necessary
    const xmlContent = extractXmlContent(xmlString);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, "text/xml");

    // Extract the root element
    const codeChangesNode = doc.querySelectorAll("code_changes")[0];
    if (!codeChangesNode) {
      console.error("No code_changes element found in the XML");
      return null;
    }

    const changedFilesNode = doc.querySelectorAll("changed_files")[0];
    if (!changedFilesNode) {
      console.error("No changed_files element found in the XML");
      return null;
    }

    const fileNodes = changedFilesNode.querySelectorAll("file");
    const changes: ParsedFileChange[] = [];

    for (const fileNode of fileNodes) {

      const fileOperationNode = fileNode.querySelectorAll("file_operation")[0];
      const filePathNode = fileNode.querySelectorAll("file_path")[0];
      const fileCodeNode = fileNode.querySelectorAll("file_code")[0];

      if (!fileOperationNode || !filePathNode) {
        console.warn("Missing required file_operation or file_path element");
        continue;
      }

      const file_operation = fileOperationNode.textContent?.trim() ?? "";
      const file_path = filePathNode.textContent?.trim() ?? "";

      let file_code: string | undefined;
      if (fileCodeNode) {
        // Handle CDATA content correctly
        file_code = extractNodeContent(fileCodeNode);
      }

      changes.push({
        file_operation,
        file_path,
        file_code
      });
    }

    return changes;
  } catch (error: unknown) {
    console.error("Error parsing XML:", error);
    return null;
  }
}

// Function to extract the content of a node, including CDATA sections
function extractNodeContent(node: any): string {
  if (!node || !node.childNodes) return "";
  
  let content = "";
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    // Check for CDATA sections and regular text nodes
    if (child.nodeType === 4 || child.nodeType === 3) { // 4 is CDATA, 3 is Text
      content += child.nodeValue;
    }
  }
  
  return content;
}

// Function to extract XML content from potential markdown code blocks
function extractXmlContent(input: string): string {
  // Check if the input is wrapped in markdown code blocks
  const markdownMatch = input.match(/```(?:xml)?([^`]+)```/);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }
  
  // If not in markdown format, return the original input
  return input.trim();
} 