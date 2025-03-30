import { useState } from "react";

import { parseXmlString } from "../main/xml-utils";
import { FileChange, XmlApplyTabProps } from "../types/file-types";

/* Removed unused constant DEFAULT_XML_INSTRUCTIONS */

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
    } catch (error_) {
      setError(`Error parsing XML: ${error_ instanceof Error ? error_.message : String(error_)}`);
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