# XML Changes Feature

The XML Changes feature allows you to apply multiple file changes to your project at once using a standardized XML format. This is particularly useful when you need to create, update, or delete multiple files as part of a single operation.

## How It Works

1. Generate XML code that defines the changes you want to make
2. Open the "Apply Changes" modal in the application
3. Paste your XML code into the text area
4. Click "Apply Changes" to process the changes

## XML Format

The XML format consists of a `<changed_files>` root element containing one or more `<file>` elements, each representing a file change:

```xml
<changed_files>
  <file>
    <file_summary>Brief description of what changed</file_summary>
    <file_operation>CREATE|UPDATE|DELETE</file_operation>
    <file_path>relative/path/to/file.ext</file_path>
    <file_code>
      // The complete new content for the file (for CREATE or UPDATE operations)
    </file_code>
  </file>
  <!-- Add more file elements as needed -->
</changed_files>
```

### Elements

- **file_summary**: A brief description of the change (optional but recommended)
- **file_operation**: The type of operation - must be one of:
  - `CREATE`: Create a new file
  - `UPDATE`: Update an existing file
  - `DELETE`: Remove a file
- **file_path**: The path to the file relative to your project root
- **file_code**: The complete content for the file (required for CREATE and UPDATE operations)

## Special Character Handling

The system automatically handles special characters in your code, including:

- XML reserved characters (`<`, `>`, `&`, `'`, `"`)
- JSX/TSX syntax (React components with brackets and attributes)
- HTML tags and attributes
- Special symbols and unicode characters

You don't need to manually escape any characters or use CDATA sections - the system handles this for you internally.

## Example

Here's a complete example that:
1. Creates a new React component
2. Updates an existing CSS file
3. Deletes an unused file

```xml
<changed_files>
  <file>
    <file_summary>Create new Button component</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/components/Button.tsx</file_path>
    <file_code>
import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

const Button: React.FC<ButtonProps> = ({ 
  label, 
  onClick, 
  variant = 'primary' 
}) => {
  return (
    <button 
      className={`button ${variant}`} 
      onClick={onClick}
    >
      {label}
    </button>
  );
};

export default Button;
    </file_code>
  </file>
  <file>
    <file_summary>Update button styles</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/styles/buttons.css</file_path>
    <file_code>
.button {
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.button.primary {
  background-color: #0070f3;
  color: white;
}

.button.primary:hover {
  background-color: #0060df;
}

.button.secondary {
  background-color: #f5f5f5;
  color: #333;
}

.button.secondary:hover {
  background-color: #e5e5e5;
}
    </file_code>
  </file>
  <file>
    <file_summary>Remove unused component</file_summary>
    <file_operation>DELETE</file_operation>
    <file_path>src/components/OldButton.tsx</file_path>
  </file>
</changed_files>
```

## Troubleshooting

If you encounter an error when applying changes:

1. Make sure your XML follows the correct format with all required elements
2. Check that file paths are relative to your project root
3. Verify that operations are one of the allowed types: CREATE, UPDATE, or DELETE
4. For CREATE and UPDATE operations, ensure you've included the file_code element with the complete file content

If issues persist, check the application logs for more detailed error information. 