import { Check, Loader2 } from 'lucide-react';
import './workspace-save-button.css';

interface WorkspaceSaveButtonProps {
  saveState: 'idle' | 'saving' | 'success';
  workspaceName: string;
  isRenamingActive: boolean;
  workspaceNames: string[];
  disabled: boolean;
  onSave: () => void;
}

export const WorkspaceSaveButton = ({
  saveState,
  workspaceName,
  isRenamingActive,
  workspaceNames,
  disabled,
  onSave
}: WorkspaceSaveButtonProps): JSX.Element => {
  const getApplyButtonClassName = () => {
    let className = "apply-button save-button";
    if (saveState !== 'idle') {
      className += ` save-${saveState}`;
    }
    return className;
  };

  const getApplyButtonTitle = () => {
    if (isRenamingActive) {
      return "Complete or cancel the current rename operation first";
    }
    if (saveState === 'saving') {
      return "Saving...";
    }
    if (saveState === 'success') {
      return "Saved!";
    }
    return workspaceNames.includes(workspaceName.trim()) ? 'Overwrite Workspace' : 'Save Workspace';
  };

  const getApplyButtonText = () => {
    return workspaceNames.includes(workspaceName.trim()) ? 'Overwrite Workspace' : 'Save Workspace';
  };

  return (
    <button 
      className={getApplyButtonClassName()}
      onClick={onSave}
      disabled={disabled}
      title={getApplyButtonTitle()}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <span className={`button-text ${saveState === 'idle' ? '' : 'hide'}`}>
        {getApplyButtonText()}
      </span>
      {saveState === 'saving' && (
        <Loader2 size={16} className="button-icon spin" />
      )}
      {saveState === 'success' && (
        <Check size={16} className="button-icon success-check" />
      )}
    </button>
  );
};