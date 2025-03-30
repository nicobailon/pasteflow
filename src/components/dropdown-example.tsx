import { ChevronDown } from "lucide-react";
import { useState } from "react";
import Dropdown, { DropdownOption } from "./dropdown";

const DropdownExample = (): JSX.Element => {
  // Example sort options similar to the ones used in sidebar.tsx
  const sortOptions: DropdownOption[] = [
    { value: "default", label: "Developer-Focused", icon: <span>↕</span> },
    { value: "name-asc", label: "Name (A–Z)", icon: <span>↑</span> },
    { value: "name-desc", label: "Name (Z–A)", icon: <span>↓</span> },
    { value: "extension-asc", label: "Extension (A–Z)", icon: <span>↑</span> },
    { value: "extension-desc", label: "Extension (Z–A)", icon: <span>↓</span> },
    { value: "date-desc", label: "Date Modified (Newest)", icon: <span>↓</span> },
    { value: "date-asc", label: "Date Modified (Oldest)", icon: <span>↑</span> },
  ];

  // State to track the selected sort option
  const [sortOption, setSortOption] = useState("default");

  const handleSortChange = (value: string) => {
    setSortOption(value);
    // In a real app, you might perform additional actions here
    console.log(`Sort option changed to: ${value}`);
  };

  return (
    <div className="dropdown-example">
      <h3>Dropdown Component Examples</h3>
      
      <div className="example-section">
        <h4>Basic Sort Dropdown</h4>
        <Dropdown
          options={sortOptions}
          value={sortOption}
          onChange={handleSortChange}
          buttonLabel="Sort"
          buttonIcon={<ChevronDown size={16} />}
        />
      </div>

      <div className="example-section">
        <h4>Right-Aligned Dropdown</h4>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Dropdown
            options={sortOptions}
            value={sortOption}
            onChange={handleSortChange}
            position="right"
            buttonClassName="sidebar-button" 
          />
        </div>
      </div>

      <div className="example-section">
        <h4>Custom Styling</h4>
        <Dropdown
          options={sortOptions}
          value={sortOption}
          onChange={handleSortChange}
          buttonLabel="Custom Style"
          containerClassName="sort-dropdown-container"
          buttonClassName="sort-dropdown-button"
          menuClassName="sort-dropdown-file-tree"
          activeItemClassName="sort-option"
        />
      </div>
    </div>
  );
};

export default DropdownExample; 