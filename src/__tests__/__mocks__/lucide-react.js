const React = require('react');

const USED_ICONS = [
  'Archive', 'Check', 'CheckSquare', 'ChevronDown', 'ChevronRight', 'ChevronUp',
  'CirclePlus', 'Clipboard', 'Copy', 'Edit', 'Eye', 'File', 'FileText', 'Filter',
  'Folder', 'FolderOpen', 'Loader2', 'MessageSquareCode', 'Moon', 'Pencil', 'Plus',
  'RefreshCw', 'Save', 'Search', 'Settings', 'Square', 'Sun', 'Trash', 'User', 'X',
  'Eraser'
];

// Convert camelCase to kebab-case
function toKebabCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

const mockIcons = USED_ICONS.reduce((acc, iconName) => {
  acc[iconName] = ({ size, className, ...props }) => (
    React.createElement('div', {
      'data-testid': `${toKebabCase(iconName)}-icon`,
      'data-size': size,
      className: className,
      ...props
    })
  );
  return acc;
}, {});

module.exports = mockIcons;