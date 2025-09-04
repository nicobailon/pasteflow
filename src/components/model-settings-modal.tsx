import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { X, Shield, CheckCircle2 } from "lucide-react";
import AgentAlertBanner from "./agent-alert-banner";

type ProviderId = "openai" | "anthropic" | "openrouter";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function ModelSettingsModal({ isOpen, onClose }: Props) {
  const [tab, setTab] = useState<ProviderId>("openai");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error" | "testing">("idle");
  const [error, setError] = useState<string | null>(null);

  // OpenAI
  const [openaiInput, setOpenaiInput] = useState("");
  const [openaiStored, setOpenaiStored] = useState<boolean>(false);

  // Anthropic
  const [anthropicInput, setAnthropicInput] = useState("");
  const [anthropicStored, setAnthropicStored] = useState<boolean>(false);

  // OpenRouter
  const [openrouterInput, setOpenrouterInput] = useState("");
  const [openrouterStored, setOpenrouterStored] = useState<boolean>(false);
  const [openrouterBaseUrl, setOpenrouterBaseUrl] = useState("https://openrouter.ai/api/v1");

  // General config
  const [temperature, setTemperature] = useState<number>(0.3);
  const [maxOut, setMaxOut] = useState<number>(4000);

  function useApiInfo() {
    const info = (window as any).__PF_API_INFO || {};
    const apiBase = typeof info.apiBase === "string" ? info.apiBase : "http://127.0.0.1:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }
  const { apiBase, authToken } = useApiInfo();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [okey, akey, orKey, orBase, temp, max] = await Promise.all([
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openai.apiKey' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.anthropic.apiKey' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openrouter.apiKey' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openrouter.baseUrl' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.temperature' }),
          (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.maxOutputTokens' }),
        ]);
        if (!mounted) return;
        setOpenaiStored(Boolean(okey?.data));
        setAnthropicStored(Boolean(akey?.data));
        setOpenrouterStored(Boolean(orKey?.data));
        if (typeof orBase?.data === 'string' && orBase.data.trim()) setOpenrouterBaseUrl(orBase.data);
        const t = Number(temp?.data);
        if (Number.isFinite(t)) setTemperature(Math.max(0, Math.min(2, t)));
        const m = Number(max?.data);
        if (Number.isFinite(m)) setMaxOut(Math.max(1, Math.min(128_000, m)));
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [isOpen]);

  const canSave = status !== 'saving' && status !== 'testing';

  async function saveKey(key: string, value: string | null, enc = true) {
    setStatus('saving');
    setError(null);
    try {
      await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key, value, encrypted: enc });
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1000);
    } catch (e) {
      setStatus('error');
      setError((e as Error)?.message || 'Failed to save');
    }
  }

  async function testProvider(provider: ProviderId) {
    setStatus('testing');
    setError(null);
    try {
      // Use current default model for provider
      const modelPref = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' });
      const model = (modelPref && modelPref.success && typeof modelPref.data === 'string') ? modelPref.data : 'gpt-4o-mini';
      const body: any = { provider, model, temperature: 0, maxOutputTokens: 1 };
      if (provider === 'openai') body.apiKey = openaiInput || undefined;
      if (provider === 'anthropic') body.apiKey = anthropicInput || undefined;
      if (provider === 'openrouter') { body.apiKey = openrouterInput || undefined; body.baseUrl = openrouterBaseUrl || undefined; }
      const resp = await fetch(`${apiBase}/api/v1/models/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      const ok = json?.data?.ok === true || json?.ok === true;
      if (!ok) throw new Error(json?.data?.error || json?.error || 'Validation failed');
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1000);
    } catch (e) {
      setStatus('error');
      setError((e as Error)?.message || 'Validation failed');
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content workspace-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Model Settings</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="modal-body">
            <div className="integrations-note" style={{ marginBottom: 12 }}>
              <Shield size={16} />
              <div className="integrations-note-text">API keys are stored encrypted and used only locally.</div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className={`secondary ${tab === 'openai' ? 'active' : ''}`} onClick={() => setTab('openai')}>OpenAI</button>
              <button className={`secondary ${tab === 'anthropic' ? 'active' : ''}`} onClick={() => setTab('anthropic')}>Anthropic</button>
              <button className={`secondary ${tab === 'openrouter' ? 'active' : ''}`} onClick={() => setTab('openrouter')}>OpenRouter</button>
            </div>

            {tab === 'openai' && (
              <div className="integration-field">
                <div className="integration-field-header">
                  <label htmlFor="openai-key" className="integration-label">OpenAI API key</label>
                  {openaiStored && (
                    <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>
                  )}
                </div>
                <input id="openai-key" type="password" placeholder="sk-..." value={openaiInput} onChange={(e) => setOpenaiInput(e.target.value)} className="prompt-title-input integration-input" />
                <div className="integration-actions">
                  <button className="apply-button" disabled={!canSave || !openaiInput.trim()} onClick={() => saveKey('integrations.openai.apiKey', openaiInput.trim(), true)}>Save</button>
                  <button className="cancel-button" disabled={!canSave || !openaiStored} onClick={() => saveKey('integrations.openai.apiKey', null, false)}>Remove</button>
                  <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openai')}>Test</button>
                </div>
              </div>
            )}

            {tab === 'anthropic' && (
              <div className="integration-field">
                <div className="integration-field-header">
                  <label htmlFor="anthropic-key" className="integration-label">Anthropic API key</label>
                  {anthropicStored && (
                    <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>
                  )}
                </div>
                <input id="anthropic-key" type="password" placeholder="sk-ant-..." value={anthropicInput} onChange={(e) => setAnthropicInput(e.target.value)} className="prompt-title-input integration-input" />
                <div className="integration-actions">
                  <button className="apply-button" disabled={!canSave || !anthropicInput.trim()} onClick={() => saveKey('integrations.anthropic.apiKey', anthropicInput.trim(), true)}>Save</button>
                  <button className="cancel-button" disabled={!canSave || !anthropicStored} onClick={() => saveKey('integrations.anthropic.apiKey', null, false)}>Remove</button>
                  <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('anthropic')}>Test</button>
                </div>
              </div>
            )}

            {tab === 'openrouter' && (
              <div className="integration-field">
                <div className="integration-field-header">
                  <label htmlFor="openrouter-key" className="integration-label">OpenRouter API key</label>
                  {openrouterStored && (
                    <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>
                  )}
                </div>
                <input id="openrouter-key" type="password" placeholder="sk-or-v1-..." value={openrouterInput} onChange={(e) => setOpenrouterInput(e.target.value)} className="prompt-title-input integration-input" />
                <label htmlFor="openrouter-base" className="integration-label" style={{ marginTop: 8 }}>Base URL</label>
                <input id="openrouter-base" type="text" placeholder="https://openrouter.ai/api/v1" value={openrouterBaseUrl} onChange={(e) => setOpenrouterBaseUrl(e.target.value)} className="prompt-title-input integration-input" />
                <div className="integration-actions">
                  <button className="apply-button" disabled={!canSave || !openrouterInput.trim()} onClick={() => saveKey('integrations.openrouter.apiKey', openrouterInput.trim(), true)}>Save</button>
                  <button className="cancel-button" disabled={!canSave || !openrouterStored} onClick={() => saveKey('integrations.openrouter.apiKey', null, false)}>Remove</button>
                  <button className="secondary" disabled={!canSave} onClick={() => saveKey('integrations.openrouter.baseUrl', openrouterBaseUrl.trim(), false)}>Save Base URL</button>
                  <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openrouter')}>Test</button>
                </div>
              </div>
            )}

            <div className="integration-field" style={{ marginTop: 16 }}>
              <div className="integration-field-header">
                <label className="integration-label">Defaults</label>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Temperature</label>
                <input type="number" step={0.1} min={0} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="prompt-title-input integration-input" style={{ width: 100 }} />
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Max output tokens</label>
                <input type="number" min={1} max={128000} value={maxOut} onChange={(e) => setMaxOut(Number(e.target.value))} className="prompt-title-input integration-input" style={{ width: 120 }} />
                <button className="apply-button" disabled={!canSave} onClick={async () => {
                  setStatus('saving'); setError(null);
                  try {
                    await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.temperature', value: temperature });
                    await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.maxOutputTokens', value: maxOut });
                    setStatus('success'); setTimeout(() => setStatus('idle'), 1000);
                  } catch (e) { setStatus('error'); setError((e as Error)?.message || 'Failed to save'); }
                }}>Save Defaults</button>
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
}

