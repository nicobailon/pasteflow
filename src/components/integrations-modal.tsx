import * as Dialog from "@radix-ui/react-dialog";
import { X, Shield, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AgentAlertBanner from "./agent-alert-banner";
import "./integrations-modal.css";

type IntegrationsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

function isSecretObject(v: unknown): boolean {
  const o = v as any;
  return o && typeof o === 'object' && o.__type === 'secret' && o.v === 1;
}

const IntegrationsModal = ({ isOpen, onClose }: IntegrationsModalProps): JSX.Element => {
  const [status, setStatus] = useState<'idle'|'loading'|'saving'|'error'|'success'>('idle');
  const [openaiInput, setOpenaiInput] = useState<string>("");
  const [openaiStored, setOpenaiStored] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(() => openaiInput.trim().length > 0, [openaiInput]);

  useEffect(() => {
    if (!isOpen) return;
    setStatus('loading');
    setError(null);
    // Query presence of stored key
    window.electron.ipcRenderer.invoke('/prefs/get', { key: 'integrations.openai.apiKey' })
      .then((res: any) => {
        const value = (res && typeof res === 'object' && 'success' in res) ? (res as any).data : res;
        setOpenaiStored(Boolean(value && (isSecretObject(value) || (typeof value === 'string' && value.length > 0))));
        setStatus('idle');
      })
      .catch((e: unknown) => {
        setOpenaiStored(false);
        setStatus('error');
        setError((e as Error)?.message || 'Failed to load status');
      });
  }, [isOpen]);

  const saveOpenAIKey = async () => {
    try {
      setStatus('saving');
      setError(null);
      await window.electron.ipcRenderer.invoke('/prefs/set', { key: 'integrations.openai.apiKey', value: openaiInput.trim(), encrypted: true });
      setOpenaiInput("");
      setOpenaiStored(true);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1200);
    } catch (e) {
      setStatus('error');
      setError((e as Error)?.message || 'Failed to save');
    }
  };

  const clearOpenAIKey = async () => {
    try {
      setStatus('saving');
      setError(null);
      await window.electron.ipcRenderer.invoke('/prefs/set', { key: 'integrations.openai.apiKey', value: null });
      setOpenaiStored(false);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1000);
    } catch (e) {
      setStatus('error');
      setError((e as Error)?.message || 'Failed to clear');
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content workspace-modal integrations-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Integrations</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="modal-body integrations-modal-body">
            <div className="integrations-note">
              <Shield size={16} />
              <div className="integrations-note-text">API keys are stored encrypted and used only locally.</div>
            </div>

            <div className="integration-field">
              <div className="integration-field-header">
                <label htmlFor="openai-key" className="integration-label">OpenAI API key</label>
                {openaiStored && (
                  <span className="configured-indicator">
                    <CheckCircle2 size={14} /> Configured
                  </span>
                )}
              </div>
              <input
                id="openai-key"
                type="password"
                placeholder="sk-..."
                value={openaiInput}
                onChange={(e) => setOpenaiInput(e.target.value)}
                className="prompt-title-input integration-input"
              />
              <div className="integration-actions">
                <button className="apply-button" onClick={saveOpenAIKey} disabled={!canSave || status === 'saving'}>
                  Save
                </button>
                <button className="cancel-button" onClick={clearOpenAIKey} disabled={!openaiStored || status === 'saving'}>
                  Remove
                </button>
              </div>
            </div>

            {status === 'error' && (
              <AgentAlertBanner variant="error" message={error || 'Failed to update'} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default IntegrationsModal;
