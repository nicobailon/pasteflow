import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface FilterModalProps {
  exclusionPatterns: string[];
  onSave: (patterns: string[]) => void;
  onClose: () => void;
}

const FilterModal: React.FC<FilterModalProps> = ({
  exclusionPatterns,
  onSave,
  onClose,
}) => {
  // Convert array to string for editing
  const [patternsText, setPatternsText] = useState<string>("");

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
      .map(line => line.trim())
      .filter(line => line !== "" && !line.startsWith("#"));
    
    onSave(patterns);
  };

  return (
    <div className="modal-overlay">
      <div className="modal filter-modal">
        <div className="modal-header">
          <h2>File Exclusion Filters</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-content">
          <p className="filter-info">
            Files matching these patterns will be excluded from the file list.
            Changes will apply after saving and refreshing the file list.
          </p>
          
          <textarea
            className="filter-patterns-input"
            value={patternsText}
            onChange={(e) => setPatternsText(e.target.value)}
            spellCheck={false}
            rows={15}
          />
        </div>
        
        <div className="modal-footer">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={handleSave}>
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterModal;