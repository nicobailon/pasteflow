# XML Changes Feature

The XML Changes feature allows you to apply multiple file changes to your project using a structured XML format. This is useful for applying code changes, refactoring, or implementing new features across multiple files in a single operation.

## XML Format

The XML format for changes follows this structure:

```xml
<changed_files>
  <file>
    <file_summary>Brief description of what changed</file_summary>
    <file_operation>CREATE|UPDATE|DELETE</file_operation>
    <file_path>relative/path/to/file.ext</file_path>
    <file_code>
      // The complete new content for the file (for CREATE or UPDATE operations)
      // Do not use placeholders or ellipses
    </file_code>
  </file>
  <!-- Add more file elements as needed for additional changes -->
</changed_files>
```

### Format Guidelines

1. **file_operation** must be one of:
   - `CREATE`: For new files
   - `UPDATE`: To modify existing files
   - `DELETE`: To remove files (file_code not required)
2. **file_path**: Use relative paths from the project root
3. **file_code**: Include complete file content for CREATE/UPDATE operations
4. For DELETE operations, the file_code element can be omitted

## Using the Apply Changes Modal

1. Open the Apply Changes Modal from the main menu or using the keyboard shortcut
2. Select the target folder where changes should be applied
3. Paste your XML content into the text area
4. Click "Apply Changes" to process the changes

## Example

Here's an example of XML that updates a component and creates a new utility file:

```xml
<changed_files>
  <file>
    <file_summary>Update SearchBar component with improved accessibility</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/SearchBar.tsx</file_path>
    <file_code>
import React, { useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

const SearchBar = ({
  searchTerm,
  onSearchChange,
  placeholder = "Search...",
  ariaLabel = "Search input"
}: SearchBarProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={`search-bar ${isFocused ? "focused" : ""}`}>
      <div className="search-icon" aria-hidden="true">
        <Search size={16} />
      </div>
      <input
        type="text"
        className="search-input"
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-label={ariaLabel}
      />
      {searchTerm && (
        <button
          className="search-clear-btn"
          onClick={() => onSearchChange("")}
          aria-label="Clear search"
          type="button"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
    </file_code>
  </file>
  <file>
    <file_summary>Create new utility function for date formatting</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/utils/dateFormatter.ts</file_path>
    <file_code>
/**
 * Utility functions for formatting dates
 */

/**
 * Format a date as a readable string (e.g., "Jan 1, 2023")
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format a date as a time string (e.g., "3:45 PM")
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
    </file_code>
  </file>
</changed_files>
```

## Error Handling

The XML parser will validate your XML and provide error messages if there are issues:

- Invalid XML format
- Missing required elements
- Missing code for CREATE or UPDATE operations
- File path issues

## Implementation Details

The XML Changes feature is implemented using:

- `@xmldom/xmldom` for XML parsing
- React components for the UI
- Electron IPC for communication between the renderer and main processes

## Testing

You can test your XML changes before applying them using the validation tools:

1. Create your XML changes
2. Use the `validateXmlChanges` function to check for errors
3. Review the changes summary using `generateChangesSummary`

See the `src/examples/test-xml-parser.ts` file for a demonstration of how to use these functions.

## Best Practices

1. Always validate your XML before applying changes
2. Use meaningful file summaries to document what changed
3. Include complete file content for CREATE and UPDATE operations
4. Test your changes on a copy of your project first
5. Consider using version control to track changes 