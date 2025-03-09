import React, { useState, useEffect } from "react";

interface FilterModalProps {
  exclusionPatterns: string[];
  onSave: (patterns: string[]) => void;
  onClose: () => void;
}

const FilterModal = ({
  exclusionPatterns,
  onSave,
  onClose,
}: FilterModalProps) => {
  // Convert array to string for editing
  const [patternsText, setPatternsText] = useState("");

  // Initialize textarea content
  useEffect(() => {
    // Format initial content with header comments
    const formattedPatterns = [
      "# Enter patterns to exclude, one per line",
      "# Use glob patterns like: **/node_modules/, **/*.tmp",
      "# Lines starting with # are comments",
      "",
      ...exclusionPatterns
    ].join("\n");
    
    setPatternsText(formattedPatterns);
  }, [exclusionPatterns]);

  // Handle save button click
  const handleSave = () => {
    // Parse the text to get an array of patterns
    const patterns = patternsText
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line !== "" && !line.startsWith("#"));
    
    onSave(patterns);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content filter-modal">
        <div className="modal-header">
          <h2>File Exclusion Filters</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <p className="modal-description">
            Files matching these patterns will be excluded from the file list.
            Changes will apply after saving and refreshing the file list.
          </p>
          
          <textarea
            className="xml-input"
            value={patternsText}
            onChange={(e) => setPatternsText(e.target.value)}
            spellCheck={false}
            rows={15}
          />
        </div>
        
        <div className="modal-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="apply-button" onClick={handleSave}>
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterModal;