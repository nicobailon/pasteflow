import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

interface ApplyChangesModalProps {
  selectedFolder: string;
  onClose: () => void;
  isOpen?: boolean;
}

// Response type definition
interface ApplyChangesResponse {
  success: boolean; 
  message?: string;
  error?: string;
  details?: string;
  updatedFiles?: string[];
  failedFiles?: { path: string, reason: string }[];
  warningMessage?: string;
}

// Helper function to format failed files list - moved to outer scope
const formatFailedFiles = (failedFiles?: { path: string, reason: string }[]): string => {
  if (!failedFiles?.length) return "";
  
  let message = "\n\nFailed files:";
  for (const failure of failedFiles) {
    message += `\n- ${failure.path}: ${failure.reason}`;
  }
  return message;
};

// Helper function to format a success message
const formatSuccessMessage = (response: ApplyChangesResponse): string => {
  let statusMessage = `Success: ${response.message || "Changes applied successfully"}`;
  
  // Add updated files list
  if (response.updatedFiles?.length) {
    const updatedFilesList = response.updatedFiles.map(file => `- ${file}`).join('\n');
    statusMessage += `\n\nUpdated files:\n${updatedFilesList}`;
  } else {
    statusMessage += "\n\nNote: No files were actually updated.";
  }
  
  // Add warnings if present
  if (response.warningMessage) {
    statusMessage += `\n\nWarning: ${response.warningMessage}`;
    statusMessage += formatFailedFiles(response.failedFiles);
  }
  
  return statusMessage;
};

// Helper function to format an error message
const formatErrorMessage = (response: ApplyChangesResponse): string => {
  let errorMessage = `Error: ${response.error || "Failed to apply changes"}`;
  errorMessage += formatFailedFiles(response.failedFiles);
  return errorMessage;
};

export function ApplyChangesModal({ 
  selectedFolder, 
  onClose, 
  isOpen = true
}: ApplyChangesModalProps): JSX.Element {
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [formatInstructions, setFormatInstructions] = useState("");

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
    const handleResponse = (response: ApplyChangesResponse) => {
      setIsProcessing(false);
      
      if (response.success) {
        setStatus(formatSuccessMessage(response));
        setXml(""); // Clear the XML input on success
      } else {
        setStatus(formatErrorMessage(response));
      }
    };

    // Add event listener
    window.electron.ipcRenderer.on("apply-changes-response", handleResponse);

    // Clean up event listener on unmount
    return () => {
      window.electron.ipcRenderer.removeListener("apply-changes-response", handleResponse);
    };
  }, []);

  // Use formatInstructions directly instead of storing in unused variable
  const placeholderText = formatInstructions || `
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
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content notes-app-layout">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Apply XML Changes</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button"><X size={16} /></button>
            </Dialog.Close>
          </div>
          
          <div className="modal-body">
            <div className="xml-editor-container">
              <p className="modal-description">
                Paste XML to apply file changes to the selected folder:
                <br />
                <strong>{selectedFolder}</strong>
              </p>

              <textarea
                className="prompt-content-input xml-input"
                value={xml}
                onChange={(e) => setXml(e.target.value)}
                placeholder={placeholderText}
                rows={15}
                disabled={isProcessing}
              />

              <p>
                <button 
                  className="documentation-link" 
                  onClick={() => {
                    window.electron.ipcRenderer.send('open-docs', 'XML_CHANGES.md');
                  }}
                >
                  View full documentation
                </button>
              </p>
              
              {status && (
                <div className={`status-message ${status.startsWith("Error") ? "error" : (status.startsWith("Success") ? "success" : "")}`}
                    style={{ whiteSpace: "pre-line" }}>
                  {status}
                </div>
              )}
            </div>
          </div>
          
          <div className="modal-footer">
            <button 
              className="apply-button"
              onClick={handleApply}
              disabled={!xml.trim() || isProcessing}
            >
              {isProcessing ? "Applying..." : "Apply Changes"}
            </button>
            <Dialog.Close asChild>
              <button 
                className="cancel-button"
                disabled={isProcessing}
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 