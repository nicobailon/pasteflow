export const XML_FORMATTING_INSTRUCTIONS_REACT = `<xml_formatting_instructions>
Please analyze the code above and help me make changes to these files. Generate your response in the following XML format that can be pasted directly into the "Apply XML Changes" feature:

<changed_files>
  <file>
    <file_summary>Brief description of what changed</file_summary>
    <file_operation>CREATE|UPDATE|DELETE</file_operation>
    <file_path>relative/path/to/file.ext</file_path>
    <file_code><![CDATA[
      // The complete new content for the file (for CREATE or UPDATE operations)
      // For React/JSX code, wrapping in CDATA ensures proper XML parsing
    ]]></file_code>
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
5. **CRITICAL**: For React/JSX code, ALWAYS wrap the code in CDATA sections using <![CDATA[ and ]]> tags

## React/JSX Special Instructions
When modifying React components:
1. ALWAYS wrap JSX code in CDATA tags (<![CDATA[ and ]]>)
2. Do not remove the CDATA tags even if you think they're not needed
3. Template literals with backticks and \${} interpolation need to be inside CDATA sections
4. JSX attributes with expressions (like className={\`...\${expression}...\`}) are only safe inside CDATA sections
5. Without CDATA sections, XML parsing will fail for React code containing JSX expressions

## Common Issues to Avoid:
1. Unquoted className attributes with template literals will break XML parsing
2. JSX expressions with curly braces outside CDATA will be interpreted as malformed XML attributes
3. Removing CDATA tags when modifying existing code will cause parsing errors

## Example for a React Component with Template Literals:
\`\`\`XML
<changed_files>
  <file>
    <file_summary>Update CopyButton component with animations</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/CopyButton.tsx</file_path>
    <file_code><![CDATA[
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  className?: string;
  children?: JSX.Element | string;
}

const CopyButton = ({ text, className = "", children }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      type="button"
      className={\`relative transition-all duration-200 ease-in-out transform \${
        isHovered ? "scale-110" : "scale-100"
      } \${
        copied ? "bg-green-500 text-white" : "bg-gray-100 hover:bg-gray-200"
      } rounded-md p-2 \${className}\`}
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        boxShadow: isHovered ? "0 4px 6px rgba(0, 0, 0, 0.1)" : "none",
      }}
    >
      <span className={\`flex items-center justify-center \${copied ? "animate-pulse" : ""}\`}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {children && <span className="ml-2">{children}</span>}
      </span>
      {copied && (
        <span className="absolute -top-7 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded opacity-70">
          Copied!
        </span>
      )}
    </button>
  );
};

export default CopyButton;
    ]]></file_code>
  </file>
</changed_files>
\`\`\`

IMPORTANT: Your changes must be in this exact XML format with proper CDATA sections to be applied correctly by the system.
</xml_formatting_instructions>`;

export const REACT_COMPONENT_XML_TEMPLATE = `<changed_files>
  <file>
    <file_summary>Description of component changes</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/ComponentName.tsx</file_path>
    <file_code><![CDATA[
// React component code goes here
// This will be properly parsed as XML even with JSX syntax
    ]]></file_code>
  </file>
</changed_files>`;

export const REACT_STYLESHEET_XML_TEMPLATE = `<changed_files>
  <file>
    <file_summary>Description of stylesheet changes</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/styles/stylesheet.css</file_path>
    <file_code><![CDATA[
/* CSS styles go here */
/* Complex selectors and rules are safe inside CDATA */
    ]]></file_code>
  </file>
</changed_files>`;

export const TAILWIND_COMPONENT_XML_TEMPLATE = `<changed_files>
  <file>
    <file_summary>Description of Tailwind component changes</file_summary>
    <file_operation>UPDATE</file_operation>
    <file_path>src/components/TailwindComponent.tsx</file_path>
    <file_code><![CDATA[
import React from 'react';

interface ComponentProps {
  // Props definition
}

const Component: React.FC<ComponentProps> = (props) => {
  return (
    <div className={\`
      flex items-center justify-between
      p-4 rounded-lg
      bg-white dark:bg-gray-800
      shadow-md hover:shadow-lg
      transition-all duration-300
      \${props.className || ''}
    \`}>
      {/* Component content */}
    </div>
  );
};

export default Component;
    ]]></file_code>
  </file>
</changed_files>`; 