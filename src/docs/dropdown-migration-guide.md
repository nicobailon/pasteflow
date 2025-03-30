# Dropdown Component Migration Guide

This guide explains how to migrate existing dropdown implementations to the new reusable `Dropdown` component.

## Overview

The new `Dropdown` component provides a consistent UI and behavior across the application. It handles:

- Opening/closing the dropdown
- Keyboard accessibility
- Click outside behavior
- Consistent styling
- Customization options

## Migration Steps

### 1. Import the Dropdown Component

```tsx
import Dropdown, { DropdownOption } from "./components/dropdown";
```

### 2. Define Your Options Array

Convert your existing dropdown items to the `DropdownOption` format:

```tsx
const sortOptions: DropdownOption[] = [
  { value: "default", label: "Developer-Focused", icon: <span>↕</span> },
  { value: "name-asc", label: "Name (A–Z)", icon: <span>↑</span> },
  // Add more options as needed
];
```

### 3. Add State Management

```tsx
const [currentOption, setCurrentOption] = useState("default");

const handleOptionChange = (value: string) => {
  setCurrentOption(value);
  // Add any additional logic you need when the option changes
};
```

### 4. Replace the Existing Dropdown

Replace your existing dropdown markup with the new component:

```tsx
<Dropdown
  options={sortOptions}
  value={currentOption}
  onChange={handleOptionChange}
  buttonLabel="Sort"
  buttonIcon={<ChevronDown size={16} />}
  containerClassName="sort-dropdown-container"
  buttonClassName="sort-dropdown-button"
  menuClassName="sort-dropdown-file-tree"
/>
```

## Migration Examples

### Example 1: Sort Dropdown in Sidebar

**Before:**

```tsx
<div className="sort-dropdown-container sort-dropdown-container-file-tree">
  <button onClick={() => setSortDropdownOpen(!sortDropdownOpen)} className="sidebar-button sort-dropdown-button" title="Sort Files">
    <ChevronDown size={16} />
    <span>Sort</span>
  </button>
  {sortDropdownOpen && (
    <div className="sort-dropdown sort-dropdown-file-tree">
      <button 
        onClick={() => handleFileTreeSortChange('default')}
        className={getSortButtonClassName('default')}
      >
        <span>↕</span> Developer-Focused
        {currentSortOption === 'default' && <span className="checkmark">✓</span>}
      </button>
      {/* More options */}
    </div>
  )}
</div>
```

**After:**

```tsx
const sortOptions: DropdownOption[] = [
  { value: "default", label: "Developer-Focused", icon: <span>↕</span> },
  { value: "name-asc", label: "Name (A–Z)", icon: <span>↑</span> },
  { value: "name-desc", label: "Name (Z–A)", icon: <span>↓</span> },
  // More options
];

<Dropdown
  options={sortOptions}
  value={currentSortOption}
  onChange={handleFileTreeSortChange}
  buttonLabel="Sort"
  buttonIcon={<ChevronDown size={16} />}
  containerClassName="sort-dropdown-container sort-dropdown-container-file-tree"
  buttonClassName="sidebar-button sort-dropdown-button"
  menuClassName="sort-dropdown-file-tree"
/>
```

### Example 2: Workspace Dropdown in Header

**Before:**

```tsx
<div className="workspace-dropdown">
  <div 
    className="dropdown-header" 
    onClick={toggleDropdown}
    onKeyDown={handleKeyDown}
    role="button"
    tabIndex={0}
  >
    {currentWorkspace} <ChevronDown size={16} />
  </div>
  {isDropdownOpen && (
    <div className="dropdown-menu">
      {workspaceNames.map((name) => (
        <div 
          key={name} 
          className={`dropdown-item ${name === currentWorkspace ? 'active' : ''}`}
          onClick={() => handleWorkspaceSelect(name)}
        >
          {name}
        </div>
      ))}
      <div className="dropdown-divider"></div>
      <div className="dropdown-item" onClick={handleWorkspaceToggle}>
        Manage Workspaces
      </div>
    </div>
  )}
</div>
```

**After:**

```tsx
const workspaceOptions: DropdownOption[] = [
  ...workspaceNames.map(name => ({ value: name, label: name })),
  { value: '__divider__', label: '──────────' }, // Divider option
  { value: '__manage__', label: 'Manage Workspaces' }
];

const handleWorkspaceDropdownChange = (value: string) => {
  if (value === '__manage__') {
    handleWorkspaceToggle();
  } else if (value === '__divider__') {
    // Do nothing for divider
  } else {
    handleWorkspaceSelect(value);
  }
};

<Dropdown
  options={workspaceOptions}
  value={currentWorkspace}
  onChange={handleWorkspaceDropdownChange}
  buttonLabel={currentWorkspace}
  buttonIcon={<ChevronDown size={16} />}
  containerClassName="workspace-dropdown"
  buttonClassName="dropdown-header"
  renderCustomOption={(option, isActive) => {
    if (option.value === '__divider__') {
      return <div className="dropdown-divider"></div>;
    }
    return (
      <div className={`dropdown-item ${isActive ? 'active' : ''}`}>
        {option.label}
      </div>
    );
  }}
/>
```

## Accessibility Benefits

The new Dropdown component implements several accessibility features:

- Proper ARIA attributes
- Keyboard navigation
- Focus management

## Styling Customization

You can customize every aspect of the dropdown:

- Container styling (`containerClassName`)
- Button styling (`buttonClassName`)
- Dropdown menu styling (`menuClassName`)
- Item styling (`itemClassName`)
- Active item styling (`activeItemClassName`)

## Advanced Usage

For advanced cases, use the `renderCustomOption` prop to completely customize the appearance of each option.
