import React, { useState, useEffect } from "react";

interface ApplyChangesModalProps {
  selectedFolder: string;
  onClose: () => void;
}

export function ApplyChangesModal({ selectedFolder, onClose }: ApplyChangesModalProps) {
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

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

  useEffect(() => {
    // Handle response from the main process
    const handleResponse = (response: { 
      success: boolean; 
      message?: string;
      error?: string;
    }) => {
      setIsProcessing(false);
      
      if (response.success) {
        setStatus(`Success: ${response.message || "Changes applied successfully"}`);
        // Clear the XML input on success
        setXml("");
      } else {
        setStatus(`Error: ${response.error || "Failed to apply changes"}`);
      }
    };

    // Add event listener
    window.electron.ipcRenderer.on("apply-changes-response", handleResponse);

    // Clean up event listener on unmount
    return () => {
      window.electron.ipcRenderer.removeListener("apply-changes-response", handleResponse);
    };
  }, []);

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
          
          {status && (
            <div className={`status-message ${status.startsWith("Error") ? "error" : status.startsWith("Success") ? "success" : ""}`}>
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