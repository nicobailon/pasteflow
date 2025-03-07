export const XML_FORMATTING_INSTRUCTIONS = `<xml_formatting_instructions>
Please analyze the code above and help me make changes to these files. Generate your response in the following XML format that can be pasted directly into the "Apply XML Changes" feature:

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

## Format Guidelines
1. **file_operation** must be one of:
   - CREATE: For new files
   - UPDATE: To modify existing files
   - DELETE: To remove files (file_code not required)
2. **file_path**: Use relative paths from the project root
3. **file_code**: Include complete file content for CREATE/UPDATE operations
4. For DELETE operations, the file_code element can be omitted

## Example:
\`\`\`XML
<changed_files>
  <file>
    <file_summary>Add email property to User model</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/models/User.ts</file_path>
    <file_code>
import { v4 as uuidv4 } from 'uuid';

export class User {
  id: string;
  name: string;
  email: string;
  
  constructor(name: string, email: string) {
    this.id = uuidv4();
    this.name = name;
    this.email = email;
  }
}
    </file_code>
  </file>
  <file>
    <file_summary>Create new button component</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/components/Button.tsx</file_path>
    <file_code>
import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
}

const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  return (
    <button className="custom-button" onClick={onClick}>
      {label}
    </button>
  );
};

export default Button;
    </file_code>
  </file>
  <file>
    <file_summary>Remove deprecated component</file_summary>
    <file_operation>DELETE</file_operation>
    <file_path>src/components/Deprecated.tsx</file_path>
  </file>
</changed_files>
\`\`\`

IMPORTANT: Your changes must be in this exact XML format to be applied correctly by the system.
</xml_formatting_instructions>`; 