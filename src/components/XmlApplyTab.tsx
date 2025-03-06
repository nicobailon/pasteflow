import React, { useState } from "react";
import { XmlApplyTabProps, FileChange } from "../types/FileTypes";
import { parseXmlString, formatOutputWithXmlInstructions } from "../utils/xmlUtils";

// XML instructions template
const DEFAULT_XML_INSTRUCTIONS = `### Role
- You are a **code editing assistant**: You can fulfill edit requests and chat with the user about code or other questions. Provide complete instructions or code lines when replying with xml formatting.

### Capabilities
- Can create new files.
- Can rewrite entire files.
- Can perform partial search/replace modifications.
- Can delete existing files.

Avoid placeholders like \`...\` or \`// existing code here\`. Provide complete lines or code.

## Tools & Actions
1. **create** – Create a new file if it doesn't exist.
2. **rewrite** – Replace the entire content of an existing file.
3. **modify** (search/replace) – For partial edits with <search> + <content>.
4. **delete** – Remove a file entirely (empty <content>).

### **Format to Follow for Repo Prompt's Diff Protocol**

<Plan>
Describe your approach or reasoning here.
</Plan>

<file path="path/to/example.swift" action="one_of_the_tools">
  <change>
    <description>Brief explanation of this specific change</description>
    <search>
===
// Exactly matching lines to find
===
    </search>
    <content>
===
// Provide the new or updated code here. Do not use placeholders
===
    </content>
  </change>
</file>`;

const XmlApplyTab = ({ selectedFolder }: XmlApplyTabProps) => {
  const [xmlInput, setXmlInput] = useState("");
  const [parsedChanges, setParsedChanges] = useState(null as FileChange[] | null);
  const [error, setError] = useState(null as string | null);

  const handleXmlChange = (e: any) => {
    setXmlInput(e.target.value);
  };

  const handleParseXml = () => {
    if (!xmlInput.trim()) {
      setError("Please enter XML content");
      setParsedChanges(null);
      return;
    }

    try {
      const changes = parseXmlString(xmlInput);
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