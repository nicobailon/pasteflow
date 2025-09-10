import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { X, Shield, CheckCircle2, Trash2, Copy } from "lucide-react";
import AgentAlertBanner from "./agent-alert-banner";
import "./model-settings-modal.css";
import { estimateTokenCount } from "../utils/token-utils";

type ProviderId = "openai" | "anthropic" | "openrouter";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  workspaceId?: string | null;
};

type SystemPromptMode = "default" | "override" | "prefix" | "suffix";

export default function ModelSettingsModal({ isOpen, onClose, sessionId, workspaceId }: Props) {
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
  const [enableWrites, setEnableWrites] = useState<boolean>(true);
  const [enableExec, setEnableExec] = useState<boolean>(true);
  const [approvalMode, setApprovalMode] = useState<'never'|'risky'|'always'>('risky');

  // System prompt (new)
  const [spMode, setSpMode] = useState<SystemPromptMode>("default");
  const [spText, setSpText] = useState<string>("");
  const [spScope, setSpScope] = useState<"global" | "workspace">("global");
  // Tools help is always included server-side; no toggle in UI.
  const [maxCtxTokens, setMaxCtxTokens] = useState<number>(120_000);

  // Tools enable/disable (per tool)
  type ToolToggle = { name: string; description: string; enabled: boolean };
  const [toolToggles, setToolToggles] = useState<ToolToggle[]>([]);

  function useApiInfo() {
    const info = window.__PF_API_INFO ?? {};
    const apiBase = typeof info.apiBase === "string" && info.apiBase ? info.apiBase : "http://localhost:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }
  const { apiBase, authToken } = useApiInfo();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [okey, akey, orKey, orBase, temp, max, w, x, appr, maxCtx] = await Promise.all([
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openai.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.anthropic.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openrouter.apiKey' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openrouter.baseUrl' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.temperature' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.maxOutputTokens' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.enableFileWrite' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.enableCodeExecution' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.approvalMode' }),
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.maxContextTokens' }),
        ] as const);
        if (!mounted) return;
        setOpenaiStored(Boolean(okey?.data));
        setAnthropicStored(Boolean(akey?.data));
        setOpenrouterStored(Boolean(orKey?.data));
        if (typeof orBase?.data === 'string' && orBase.data.trim()) setOpenrouterBaseUrl(orBase.data);
        const t = Number(temp?.data);
        if (Number.isFinite(t)) setTemperature(Math.max(0, Math.min(2, t)));
        const m = Number(max?.data);
        if (Number.isFinite(m)) setMaxOut(Math.max(1, Math.min(128_000, m)));
        setEnableWrites(Boolean(w?.data ?? true));
        setEnableExec(Boolean(x?.data ?? true));
        const am = String(appr?.data || '').toLowerCase();
        if (am === 'never' || am === 'risky' || am === 'always') setApprovalMode(am as any);
        const mc = Number(maxCtx?.data);
        if (Number.isFinite(mc)) setMaxCtxTokens(Math.max(1000, Math.min(2_000_000, mc)));
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

  // Load tool catalog + enabled flags for toggles
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        if (!isOpen) return;
        const res = await fetch(`${apiBase}/api/v1/tools`, { headers: { Authorization: authToken ? `Bearer ${authToken}` : '' } });
        const json = await res.json();
        const tools: Array<{ name: string; description: string }> = Array.isArray(json?.data?.tools) ? json.data.tools : [];
        const enabledRec: Record<string, boolean> = (json?.data?.enabled && typeof json.data.enabled === 'object') ? json.data.enabled : {};
        const list: ToolToggle[] = tools.map((t) => ({ name: t.name, description: t.description, enabled: enabledRec[t.name] !== false }));
        if (!aborted) setToolToggles(list);
      } catch {
        // Fallback to known tools if API is not ready
        if (!aborted) setToolToggles([
          { name: 'file', description: 'File operations', enabled: true },
          { name: 'search', description: 'Code search', enabled: true },
          { name: 'edit', description: 'Editing utilities', enabled: true },
          { name: 'context', description: 'Context utilities', enabled: true },
          { name: 'terminal', description: 'Terminal control', enabled: true },
          { name: 'generateFromTemplate', description: 'Scaffold previews', enabled: true },
        ]);
      }
    })();
    return () => { aborted = true; };
  }, [isOpen, apiBase, authToken]);

  // Helper to compute preference key based on scope
  const spKey = (base: string): string => {
    if (spScope === 'workspace' && workspaceId) return `${base}.${workspaceId}`;
    return base;
  };

  // Load system prompt preferences
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      try {
        const globalModeP = (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.systemPrompt.mode' });
        const globalTextP = (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.systemPrompt.text' });
        const wsModeP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.systemPrompt.mode.${workspaceId}` }) : Promise.resolve(null);
        const wsTextP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.systemPrompt.text.${workspaceId}` }) : Promise.resolve(null);
        const [gMode, gText, wMode, wText] = await Promise.all([globalModeP, globalTextP, wsModeP, wsTextP] as const);
        if (!mounted) return;
        const gmRaw = typeof gMode?.data === 'string' ? gMode.data : 'default';
        const gtRaw = typeof gText?.data === 'string' ? gText.data : '';
        const wmRaw = typeof wMode?.data === 'string' ? wMode.data : null;
        const wtRaw = typeof wText?.data === 'string' ? wText.data : null;

        // Prefer workspace scope if any workspace-based preference exists
        const initialScope: 'global' | 'workspace' = (workspaceId && (wmRaw || wtRaw)) ? 'workspace' : 'global';
        setSpScope(initialScope);
        const mode = (initialScope === 'workspace' ? (wmRaw || gmRaw) : gmRaw);
        const text = (initialScope === 'workspace' ? (wtRaw ?? gtRaw) : gtRaw);

        if (mode === 'default' || mode === 'override' || mode === 'prefix' || mode === 'suffix') setSpMode(mode);
        else setSpMode('default');
        setSpText(typeof text === 'string' ? text : '');
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [isOpen, workspaceId]);

  // Derived counts and warnings
  // Editor shows only the custom system prompt text (no summary/placeholder).
  const spCharCount = spText.length;
  const spTokenCount = useMemo<number>(() => estimateTokenCount(spText), [spText]);
  const spTokenWarn = useMemo<null | { level: 'info' | 'hard'; message: string }>(() => {
    const soft = Math.floor(maxCtxTokens * 0.4);
    const hard = Math.floor(maxCtxTokens * 0.9);
    if (spTokenCount >= hard) return { level: 'hard', message: `System prompt is very large (${spTokenCount.toLocaleString()} tokens). Consider reducing size.` };
    if (spTokenCount >= soft) return { level: 'info', message: `Large system prompt (${spTokenCount.toLocaleString()} tokens) reduces available context.` };
    return null;
  }, [spTokenCount, maxCtxTokens]);

  // previewText no longer needed; the editor shows the effective prompt directly.

  async function saveKey(key: string, value: string | null, enc = true) {
    setStatus('saving');
    setError(null);
    try {
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key, value, encrypted: enc });
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
      const modelPref: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' });
      const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
      const model = (isObj(modelPref) && (modelPref as Record<string, unknown>)['success'] === true && typeof (modelPref as { data?: unknown }).data === 'string')
        ? (modelPref as { data: string }).data
        : 'gpt-4o-mini';
      const body: Record<string, unknown> = { provider, model, temperature: 0, maxOutputTokens: 1 };
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

            <section className="settings-section">
              {(() => {
                const human = approvalMode === 'always' ? 'Always' : approvalMode === 'never' ? 'Never' : 'Risky only';
                const desc = approvalMode === 'always'
                  ? 'All terminal commands and apply operations require approval.'
                  : approvalMode === 'never'
                  ? 'No approval required for terminal commands or apply operations.'
                  : 'Approval required for known dangerous terminal commands; safe actions run without prompts.';
                return (
                  <AgentAlertBanner
                    variant="info"
                    message={
                      <span>
                        <strong>Approval mode:</strong> {human}. {desc}
                      </span>
                    }
                  />
                );
              })()}
              <div className="settings-grid">
                <div className="field">
                  <label>
                    <input type="checkbox" checked={enableWrites} onChange={(e) => setEnableWrites(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Enable file writes</span>
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={enableExec} onChange={(e) => setEnableExec(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Enable code execution (terminal)</span>
                  </label>
                </div>
                <div className="field">
                  <label>Approval mode</label>
                  <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as any)}>
                    <option value="never">Never</option>
                    <option value="risky">Risky only</option>
                    <option value="always">Always</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Tools enable/disable */}
            {toolToggles.length > 0 && (
              <section className="settings-section">
                <div className="field">
                  <div className="field-label-row">
                    <label>Tools</label>
                  </div>
                  <div className="settings-grid">
                    {toolToggles.map((t, idx) => (
                      <div key={t.name} className="field" style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 500 }}>{t.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.description}</div>
                          </div>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={t.enabled}
                              onChange={async (e) => {
                                const next = e.target.checked;
                                setToolToggles((prev) => prev.map((p, i) => i === idx ? { ...p, enabled: next } : p));
                                try { await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.tools.${t.name}.enabled`, value: next }); } catch { /* ignore */ }
                              }}
                            />
                            <span style={{ fontSize: 12 }}>{t.enabled ? 'Enabled' : 'Disabled'}</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* System Prompt section */}
            <section className="settings-section">
              <div className="field">
                <div className="field-label-row">
                  <label>System Prompt</label>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>Scope</label>
                    <select
                      value={spScope}
                      onChange={(e) => setSpScope((() => {
                        const v = e.target.value === 'workspace' ? 'workspace' : 'global';
                        return v;
                      })())}
                      disabled={!workspaceId}
                    >
                      <option value="global">Global (all workspaces)</option>
                      <option value="workspace" disabled={!workspaceId}>
                        {workspaceId ? 'Current workspace' : 'Current workspace (no workspace)'}
                      </option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Mode</label>
                    <select value={spMode} onChange={(e) => setSpMode((e.target.value as SystemPromptMode) || 'default')}>
                      <option value="default">Default (summary only)</option>
                      <option value="override">Override (use only custom)</option>
                      <option value="prefix">Prefix (custom above summary)</option>
                      <option value="suffix">Suffix (custom below summary)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="system-prompt-text">System prompt</label>
                <div className="help" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                  This is your custom system prompt. Leave empty for the default behavior. Editing switches Mode to Override.
                </div>
                <textarea
                  id="system-prompt-text"
                  className="prompt-content-input"
                  value={spText}
                  onChange={(e) => { setSpMode('override'); setSpText(e.target.value); }}
                  rows={10}
                  placeholder=""
                />
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {spCharCount.toLocaleString()} chars · ~{spTokenCount.toLocaleString()} tokens
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={async () => {
                      try {
                        const toCopy = spText;
                        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(toCopy);
                        else {
                          const ta = document.createElement('textarea');
                          ta.value = toCopy; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                        }
                      } catch { /* ignore */ }
                    }} title="Copy system prompt">
                      <Copy size={14} /> Copy
                    </button>
                    <button className="cancel-button" onClick={() => { setSpMode('default'); setSpText(''); }} title="Reset to default">
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              {spTokenWarn && (
                <AgentAlertBanner variant={spTokenWarn.level === 'hard' ? 'error' : 'info'} message={spTokenWarn.message} />
              )}

              {/* Preview collapsed removed; editor shows effective prompt directly. */}
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
                      const result: unknown = await window.electron?.ipcRenderer?.invoke?.('agent:export-session', sessionId);
                      const _isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
                      const ok = _isObj(result) && (result as Record<string, unknown>)['success'] === true;
                      const data = _isObj(result) ? (result as Record<string, unknown>)['data'] : undefined;
                      const file = ok && _isObj(data) && typeof (data as { file?: unknown }).file === 'string' ? (data as { file: string }).file : null;
                      const payload = ok ? data : null;
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
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.temperature', value: temperature });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.maxOutputTokens', value: maxOut });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.enableFileWrite', value: enableWrites });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.enableCodeExecution', value: enableExec });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.approvalMode', value: approvalMode });
                // System prompt persistence (respect scope)
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: spKey('agent.systemPrompt.mode'), value: spMode });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: spKey('agent.systemPrompt.text'), value: spText });
                setStatus('success'); setTimeout(() => setStatus('idle'), 1000);
              } catch (e) { setStatus('error'); setError((e as Error)?.message || 'Failed to save'); }
            }}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
