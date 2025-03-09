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
  const [validationErrors, setValidationErrors] = useState([] as string[]);

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

  // Validate a single pattern
  const validatePattern = (pattern: string): string | null => {
    // Skip empty lines and comments
    if (pattern === "" || pattern.startsWith("#")) {
      return null;
    }

    // Check for invalid characters
    if (pattern.includes('\\') && !pattern.includes('\\\\')) {
      return `Invalid escape character in "${pattern}". Use forward slashes or double backslashes.`;
    }

    // Check for unbalanced brackets
    const openBrackets = (pattern.match(/\[/g) || []).length;
    const closeBrackets = (pattern.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      return `Unbalanced brackets in "${pattern}".`;
    }

    // Check for unbalanced braces
    const openBraces = (pattern.match(/\{/g) || []).length;
    const closeBraces = (pattern.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      return `Unbalanced braces in "${pattern}".`;
    }
    
    return null;
  };

  // Handle save button click
  const onSaveClick = () => {
    // Parse the text to get an array of patterns
    const patterns = patternsText
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line !== "" && !line.startsWith("#"));
    
    // Validate patterns
    const errors: string[] = [];
    patterns.forEach((pattern: string) => {
      const error = validatePattern(pattern);
      if (error) {
        errors.push(error);
      }
    });
    
    // If there are errors, show them instead of saving
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    // Clear any previous errors and save
    setValidationErrors([]);
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
          
          {validationErrors.length > 0 && (
            <div className="validation-errors">
              <h3>Invalid patterns detected:</h3>
              <ul>
                {validationErrors.map((error: string, index: number) => (
                  <li key={index} className="error-message">{error}</li>
                ))}
              </ul>
              <p>Please fix these issues before saving.</p>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="apply-button" onClick={onSaveClick}>
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterModal;