import React, { useState } from "react";
import { XmlApplyTabProps, FileChange } from "../types/FileTypes";
// @ts-expect-error - Module is imported from main process and TypeScript can't resolve it
import { parseXmlString, formatOutputWithXmlInstructions } from "../main/xmlUtils";

// XML instructions template
const DEFAULT_XML_INSTRUCTIONS = `### Role
- You are a **code editing assistant**: You can fulfill edit requests and chat with the user about code or other questions. Provide complete instructions or code lines when replying with xml formatting.

### Capabilities
- Can create new files.
- Can rewrite entire files.
- Can delete existing files.

Avoid placeholders like \`...\` or \`// existing code here\`. Provide complete lines or code.

### Format to Follow

<changed_files>
  <file>
    <file_summary>Brief summary of the change</file_summary>
    <file_operation>CREATE | UPDATE | DELETE</file_operation>
    <file_path>path/to/file.ext</file_path>
    <file_code><![CDATA[
      // Complete code for CREATE or UPDATE operations
      // For DELETE, this can be empty
    ]]></file_code>
  </file>
  <!-- Additional <file> elements as needed -->
</changed_files>

**Important:**
- For CREATE and UPDATE operations, provide the complete, syntactically correct code inside <file_code> wrapped in CDATA.
- Ensure that all syntax is correct, including the use of backticks (\`) for template literals in JavaScript/TypeScript.
- Do not omit or replace backticks, as this can lead to invalid code.
- For JSX/TSX files, properly format template literals in className and style attributes with backticks:
  - Correct: className={\`bg-blue-500 \${isActive ? "text-white" : ""}\`}
  - Incorrect: className={bg-blue-500 \${isActive ? "text-white" : ""}}
- For DELETE operations, the <file_code> can be empty.

**Example:**

<changed_files>
  <file>
    <file_summary>Add a new button component</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/components/NewButton.tsx</file_path>
    <file_code><![CDATA[
import React, { useState } from 'react';

const NewButton = ({ label, className = "" }: { label: string, className?: string }) => {
  const [isActive, setIsActive] = useState(false);
  
  return (
    <button
      className={\`bg-blue-500 text-white p-2 rounded \${isActive ? "opacity-80" : ""} \${className}\`}
      onClick={() => setIsActive(!isActive)}
    >
      {label}
    </button>
  );
};

export default NewButton;
]]></file_code>
  </file>
</changed_files>`;

const XmlApplyTab = ({ selectedFolder }: XmlApplyTabProps) => {
  const [xmlInput, setXmlInput] = useState("");
  const [parsedChanges, setParsedChanges] = useState(null as FileChange[] | null);
  const [error, setError] = useState(null as string | null);

  const handleXmlChange = (e: any) => {
    setXmlInput(e.target.value);
  };

  const handleParseXml = async () => {
    if (!xmlInput.trim()) {
      setError("Please enter XML content");
      setParsedChanges(null);
      return;
    }

    try {
      const changes = await parseXmlString(xmlInput);
      if (changes && changes.length > 0) {
        setParsedChanges(changes);
        setError(null);
      } else {
        setError("No valid changes found in XML");
        setParsedChanges(null);
      }
    } catch (err) {
      setError(`Error parsing XML: ${err instanceof Error ? err.message : String(err)}`);
      setParsedChanges(null);
    }
  };

  return (
    <div className="xml-apply-tab">
      <h2>Apply XML Changes</h2>
      <p>Paste XML content to apply changes to the selected folder: <strong>{selectedFolder}</strong></p>
      
      <div className="xml-input-container">
        <textarea 
          className="xml-input"
          value={xmlInput}
          onChange={handleXmlChange}
          placeholder="Paste XML here..."
          rows={15}
        />
        
        <div className="xml-actions">
          <button 
            className="parse-button"
            onClick={handleParseXml}
            disabled={!xmlInput.trim()}
          >
            Parse XML
          </button>
        </div>
      </div>
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      {parsedChanges && (
        <div className="changes-summary">
          <h3>Changes to Apply</h3>
          <ul>
            {parsedChanges.map((change: FileChange, index: number) => (
              <li key={index}>
                <strong>{change.operation}</strong> {change.path}: {change.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default XmlApplyTab;