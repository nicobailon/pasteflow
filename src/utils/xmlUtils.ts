/**
 * Formats XML string for better readability
 * @param xml - The XML string to format
 * @returns Formatted XML string
 */
export function formatXml(xml: string): string {
  try {
    // Simple XML formatting implementation
    // This is a basic implementation - you may want to use a library for more complex XML
    let formatted = '';
    let indent = '';
    const tab = '  '; // 2 spaces for indentation
    
    // Add newlines and indentation
    xml.split(/>\s*</).forEach(node => {
      if (node.match(/^\/\w/)) { // Closing tag
        indent = indent.substring(tab.length);
      }
      
      formatted += indent + '<' + node + '>\n';
      
      if (node.match(/^<?\w[^>]*[^\/]$/) && !node.startsWith('!--')) { // Opening tag and not self-closing and not a comment
        indent += tab;
      }
    });
    
    // Handle CDATA sections - preserve formatting inside CDATA
    formatted = formatted.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function(match, content) {
      return '<![CDATA[' + content + ']]>';
    });
    
    return formatted.trim();
  } catch (error) {
    console.error('Error formatting XML:', error);
    return xml; // Return original XML if formatting fails
  }
}

/**
 * Adds CDATA sections to file_code elements in XML if they don't already have them
 * @param xml - The XML string to process
 * @returns XML string with CDATA sections added
 */
export function ensureCdataInFileCode(xml: string): string {
  try {
    // If there's already a CDATA section, don't modify
    if (xml.includes('<![CDATA[')) {
      return xml;
    }
    
    // Add CDATA sections to file_code elements
    return xml.replace(
      /<file_code>([\s\S]*?)<\/file_code>/g,
      (match, content) => `<file_code><![CDATA[${content}]]></file_code>`
    );
  } catch (error) {
    console.error('Error adding CDATA sections:', error);
    return xml; // Return original XML if processing fails
  }
}