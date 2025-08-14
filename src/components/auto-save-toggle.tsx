import { Save } from 'lucide-react';
import './auto-save-toggle.css';

interface AutoSaveToggleProps {
  isEnabled: boolean;
  onChange: (enabled: boolean) => void;
}

const AutoSaveToggle = ({ isEnabled, onChange }: AutoSaveToggleProps): JSX.Element => {
  return (
    <div className="auto-save-toggle-container">
      <label className="auto-save-toggle" title={isEnabled ? "Auto-save is ON" : "Auto-save is OFF"}>
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => onChange(e.target.checked)}
          className="auto-save-toggle-input"
          role="switch"
          aria-checked={isEnabled}
          aria-label="Auto-save workspace"
          data-testid="auto-save-switch"
        />
        <span className="auto-save-toggle-slider">
          <Save size={14} className="auto-save-icon" />
        </span>
        <span className="auto-save-label">Auto</span>
      </label>
    </div>
  );
};

export default AutoSaveToggle;