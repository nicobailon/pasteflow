import React, { useState, useEffect } from "react";

interface ApplyChangesModalProps {
  selectedFolder: string;
  onClose: () => void;
}

export function ApplyChangesModal({ selectedFolder, onClose }: ApplyChangesModalProps) {
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [formatInstructions, setFormatInstructions] = useState("");
  const [showFormatter, setShowFormatter] = useState(false);

  const handleApply = () => {
    if (!xml.trim()) {
      setStatus("Please enter XML content");
      return;
    }

    setIsProcessing(true);
    setStatus("Applying changes...");
    
    // Send the XML to the main process for parsing and applying changes
    window.electron.ipcRenderer.send("apply-changes", { 
      xml, 
      projectDirectory: selectedFolder 
    });
  };

  const handleFormatXml = (formattedXml: string) => {
    setXml(formattedXml);
    setShowFormatter(false);
    setStatus("XML formatted with CDATA sections to protect JSX/React code");
  };

  useEffect(() => {
    // Fetch the standard XML format instructions
    async function fetchFormatInstructions() {
      try {
        const instructions = await window.electron.ipcRenderer.invoke('get-xml-format-instructions');
        setFormatInstructions(instructions);
      } catch (error) {
        console.error('Failed to fetch XML format instructions:', error);
      }
    }
    
    fetchFormatInstructions();

    // Handle response from the main process for apply changes
    const handleResponse = (response: { 
      success: boolean; 
      message?: string;
      error?: string;
      details?: string;
      updatedFiles?: string[];
      failedFiles?: Array<{ path: string, reason: string }>;
      warningMessage?: string;
    }) => {
      setIsProcessing(false);
      
      if (response.success) {
        // Build a detailed status message that shows both successes and warnings
        let statusMessage = `Success: ${response.message || "Changes applied successfully"}`;
        
        // Always list the specific files that were updated
        if (response.updatedFiles && response.updatedFiles.length > 0) {
          statusMessage += `\n\nUpdated files:\n${response.updatedFiles.map(file => `- ${file}`).join('\n')}`;
        } else {
          // This should not happen if success is true, but just in case
          statusMessage += "\n\nNote: No files were actually updated.";
        }
        
        // Add warnings about failed files if any
        if (response.warningMessage) {
          statusMessage += `\n\nWarning: ${response.warningMessage}`;
          
          // Add detailed reasons for failures if available
          if (response.failedFiles && response.failedFiles.length > 0) {
            statusMessage += "\n\nFailure details:";
            response.failedFiles.forEach(failure => {
              statusMessage += `\n- ${failure.path}: ${failure.reason}`;
            });
          }
        }
        
        setStatus(statusMessage);
        // Clear the XML input on success
        setXml("");
      } else {
        let errorMessage = `Error: ${response.error || "Failed to apply changes"}`;
        
        // If there are failed files, list them
        if (response.failedFiles && response.failedFiles.length > 0) {
          errorMessage += "\n\nFailed files:";
          response.failedFiles.forEach(failure => {
            errorMessage += `\n- ${failure.path}: ${failure.reason}`;
          });
        }
        
        setStatus(errorMessage);
      }
    };

    // Add event listener
    window.electron.ipcRenderer.on("apply-changes-response", handleResponse);

    // Clean up event listener on unmount
    return () => {
      window.electron.ipcRenderer.removeListener("apply-changes-response", handleResponse);
    };
  }, []);

  // Display instructions from the standardized template or a fallback
  const xmlHelpText = formatInstructions || `
<changed_files>
  <file>
    <file_summary>Brief description of what changed</file_summary>
    <file_operation>CREATE|UPDATE|DELETE</file_operation>
    <file_path>relative/path/to/file.ext</file_path>
    <file_code><![CDATA[
      // The complete new content for the file
      // All JSX/TSX code should be inside CDATA sections
    ]]></file_code>
  </file>
  <!-- Add more file elements as needed -->
</changed_files>
  `.trim();

  return (
    <div className="modal-overlay">
      <div className="modal-content apply-changes-modal">
        <div className="modal-header">
          <h2>Apply XML Changes</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <p className="modal-description">
            Paste XML to apply file changes to the selected folder:
            <br />
            <strong>{selectedFolder}</strong>
          </p>

          <textarea
              className="xml-input"
              value={xml}
              onChange={(e) => setXml(e.target.value)}
              placeholder="Paste XML here..."
              rows={15}
              disabled={isProcessing}
            />

          <p>
            <a href="#" className="documentation-link" onClick={(e) => {
              e.preventDefault();
              window.electron.ipcRenderer.send('open-docs', 'XML_CHANGES.md');
            }}>View full documentation</a>
          </p>
          
          {status && (
            <div className={`status-message ${status.startsWith("Error") ? "error" : status.startsWith("Success") ? "success" : ""}`}
                 style={{ whiteSpace: "pre-line" }}>
              {status}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button 
            className="apply-button"
            onClick={handleApply}
            disabled={!xml.trim() || isProcessing}
          >
            {isProcessing ? "Applying..." : "Apply Changes"}
          </button>
          <button 
            className="cancel-button"
            onClick={onClose}
            disabled={isProcessing}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 