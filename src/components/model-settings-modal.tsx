import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { X, Shield, CheckCircle2, Trash2 } from "lucide-react";
import AgentAlertBanner from "./agent-alert-banner";
import "./model-settings-modal.css";

type ProviderId = "openai" | "anthropic" | "openrouter";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
};

export default function ModelSettingsModal({ isOpen, onClose, sessionId }: Props) {
  const [tab, setTab] = useState<ProviderId>("openai");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error" | "testing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<{ totalIn: number; totalOut: number; total: number; avgLatency: number | null; totalCost: number | null } | null>(null);

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
    const apiBase = typeof info.apiBase === "string" ? info.apiBase : "http://localhost:5839";
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

  // Load session usage stats when opened
  useEffect(() => {
    (async () => {
      try {
        if (!isOpen || !sessionId) { setUsageStats(null); return; }
        const res: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:usage:list', { sessionId });
        if (res && res.success && Array.isArray(res.data)) {
          const rows = res.data as Array<{ input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null; cost_usd: number | null }>;
          let inSum = 0, outSum = 0, totalSum = 0;
          let latSum = 0, latCount = 0;
          let costSum = 0, costCount = 0;
          for (const r of rows) {
            inSum += r.input_tokens ?? 0;
            outSum += r.output_tokens ?? 0;
            totalSum += (typeof r.total_tokens === 'number' ? r.total_tokens : ((r.input_tokens ?? 0) + (r.output_tokens ?? 0)));
            if (typeof r.latency_ms === 'number') { latSum += r.latency_ms; latCount += 1; }
            if (typeof r.cost_usd === 'number' && Number.isFinite(r.cost_usd)) { costSum += r.cost_usd; costCount += 1; }
          }
          setUsageStats({ totalIn: inSum, totalOut: outSum, total: totalSum, avgLatency: latCount > 0 ? Math.round(latSum / latCount) : null, totalCost: costCount > 0 ? costSum : null });
          try { console.log('[UI][Telemetry] settings: usage stats', { sessionId, rows: rows.length, totalIn: inSum, totalOut: outSum, total: totalSum, avgLatency: latCount > 0 ? Math.round(latSum / latCount) : null }); } catch { /* noop */ }
        } else {
          setUsageStats(null);
          try { console.log('[UI][Telemetry] settings: no usage stats', { sessionId, res }); } catch { /* noop */ }
        }
      } catch { setUsageStats(null); }
    })();
  }, [isOpen, sessionId]);

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
        <Dialog.Content className="modal-content workspace-modal model-settings-modal" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>Agent Settings</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="close-button" aria-label="Close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="modal-body">
            <div className="integrations-note">
              <Shield size={16} />
              <div className="integrations-note-text">API keys are stored encrypted and used only locally.</div>
            </div>

            <div className="settings-tabs">
              <button className={`tab-button ${tab === 'openai' ? 'active' : ''}`} onClick={() => setTab('openai')}>OpenAI</button>
              <button className={`tab-button ${tab === 'anthropic' ? 'active' : ''}`} onClick={() => setTab('anthropic')}>Anthropic</button>
              <button className={`tab-button ${tab === 'openrouter' ? 'active' : ''}`} onClick={() => setTab('openrouter')}>OpenRouter</button>
            </div>

            {tab === 'openai' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="openai-key">OpenAI API key</label>
                    {openaiStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {openaiStored ? (
                    <div className="actions" style={{ justifyContent: 'space-between' }}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-••••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.openai.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="openai-key" type="password" placeholder="sk-..." value={openaiInput} onChange={(e) => setOpenaiInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !openaiInput.trim()} onClick={() => saveKey('integrations.openai.apiKey', openaiInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openai')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {tab === 'anthropic' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="anthropic-key">Anthropic API key</label>
                    {anthropicStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {anthropicStored ? (
                    <div className="actions" style={{ justifyContent: 'space-between' }}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-ant-••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.anthropic.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="anthropic-key" type="password" placeholder="sk-ant-..." value={anthropicInput} onChange={(e) => setAnthropicInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !anthropicInput.trim()} onClick={() => saveKey('integrations.anthropic.apiKey', anthropicInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('anthropic')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {tab === 'openrouter' && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="openrouter-key">OpenRouter API key</label>
                    {openrouterStored && <span className="configured-indicator"><CheckCircle2 size={14} /> Configured</span>}
                  </div>
                  {openrouterStored ? (
                    <div className="actions" style={{ justifyContent: 'space-between' }}>
                      <code style={{ fontSize: 12, opacity: 0.8 }}>sk-or-••••••</code>
                      <button className="cancel-button" title="Remove key" onClick={() => saveKey('integrations.openrouter.apiKey', null, false)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input id="openrouter-key" type="password" placeholder="sk-or-v1-..." value={openrouterInput} onChange={(e) => setOpenrouterInput(e.target.value)} />
                      <div className="actions">
                        <button className="apply-button" disabled={!canSave || !openrouterInput.trim()} onClick={() => saveKey('integrations.openrouter.apiKey', openrouterInput.trim(), true)}>Save</button>
                        <button className="secondary" disabled={status === 'testing'} onClick={() => testProvider('openrouter')}>Test</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="openrouter-base">Base URL</label>
                  <input id="openrouter-base" type="text" placeholder="https://openrouter.ai/api/v1" value={openrouterBaseUrl} onChange={(e) => setOpenrouterBaseUrl(e.target.value)} />
                  <div className="actions right">
                    <button className="secondary" disabled={!canSave} onClick={() => saveKey('integrations.openrouter.baseUrl', openrouterBaseUrl.trim(), false)}>Save Base URL</button>
                  </div>
                </div>
              </section>
            )}

            <section className="settings-section">
              <div className="settings-grid">
                <div className="field">
                  <label>Temperature</label>
                  <input type="number" step={0.1} min={0} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Max output tokens</label>
                  <input type="number" min={1} max={128000} value={maxOut} onChange={(e) => setMaxOut(Number(e.target.value))} />
                </div>
              </div>
            </section>

            {usageStats && (
              <section className="settings-section">
                <div className="settings-grid">
                  <div className="field">
                    <label>Session Tokens</label>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Input: {usageStats.totalIn.toLocaleString()} · Output: {usageStats.totalOut.toLocaleString()} · Total: {usageStats.total.toLocaleString()}
                    </div>
                  </div>
                  <div className="field">
                    <label>Average Latency</label>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{usageStats.avgLatency != null ? (usageStats.avgLatency >= 1000 ? `${(usageStats.avgLatency/1000).toFixed(2)}s` : `${usageStats.avgLatency}ms`) : '—'}</div>
                  </div>
                  <div className="field">
                    <label>Session Cost</label>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{usageStats.totalCost != null ? `$${usageStats.totalCost.toFixed(4)}` : '—'}</div>
                  </div>
                </div>
              </section>
            )}

            <section className="settings-section">
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!sessionId || exporting === 'saving'}
                  onClick={async () => {
                    if (!sessionId) return;
                    setExporting('saving'); setExportPath(null);
                    try {
                      const result: any = await (window as any).electron?.ipcRenderer?.invoke?.('agent:export-session', sessionId);
                      const file = (result && typeof result === 'object' && result.success && result.data?.file) ? result.data.file : null;
                      const payload = (result && typeof result === 'object' && result.success) ? result.data : null;
                      if (file) setExportPath(String(file));
                      else if (payload) setExportPath('(export in memory)');
                      setExporting('success'); setTimeout(() => setExporting('idle'), 1000);
                    } catch (e) {
                      setExporting('error'); setError((e as Error)?.message || 'Export failed');
                    }
                  }}
                >
                  Export Chat Session
                </button>
                {exportPath && (
                  <span className="export-path">{exportPath}</span>
                )}
              </div>
            </section>

            {status === 'error' && (
              <AgentAlertBanner variant="error" message={error || 'Failed to update'} />
            )}
          </div>
          <div className="modal-footer">
            <div style={{ flex: 1 }} />
            <button className="apply-button" disabled={!canSave} onClick={async () => {
              setStatus('saving'); setError(null);
              try {
                await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.temperature', value: temperature });
                await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.maxOutputTokens', value: maxOut });
                setStatus('success'); setTimeout(() => setStatus('idle'), 1000);
              } catch (e) { setStatus('error'); setError((e as Error)?.message || 'Failed to save'); }
            }}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
