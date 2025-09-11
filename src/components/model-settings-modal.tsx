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

// System prompt modes removed; replaced with simple Replace Summary toggles

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
  const [execCtxGlobalEnabled, setExecCtxGlobalEnabled] = useState<boolean>(true);
  const [execCtxWorkspaceEnabled, setExecCtxWorkspaceEnabled] = useState<boolean>(true);

  // System prompts: separate global and workspace
  const [spGlobalText, setSpGlobalText] = useState<string>("");
  const [spGlobalReplace, setSpGlobalReplace] = useState<boolean>(false);
  const [spWorkspaceText, setSpWorkspaceText] = useState<string>("");
  const [spWorkspaceReplace, setSpWorkspaceReplace] = useState<boolean>(false);
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
        const [okey, akey, orKey, orBase, temp, max, w, x, appr, maxCtx, execCtx, execCtxWs] = await Promise.all([
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
          window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.executionContext.enabled' }),
          workspaceId ? window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.executionContext.enabled.${workspaceId}` }) : Promise.resolve(null),
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
        // Execution context toggles
        const storedExecGlobal = execCtx?.data;
        if (typeof storedExecGlobal === 'boolean') setExecCtxGlobalEnabled(storedExecGlobal);
        else {
          try {
            const raw = String(process.env.PF_AGENT_DISABLE_EXECUTION_CONTEXT || '').trim().toLowerCase();
            const disabled = raw === '1' || raw === 'true' || raw === 'yes';
            setExecCtxGlobalEnabled(!disabled);
          } catch { setExecCtxGlobalEnabled(true); }
        }
        const storedExecWs = (execCtxWs as any)?.data;
        if (typeof storedExecWs === 'boolean') setExecCtxWorkspaceEnabled(storedExecWs);
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

  // Load system prompt preferences (global + workspace)
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      try {
        const globalReplaceP = (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.systemPrompt.replace' });
        const globalTextP = (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.systemPrompt.text' });
        const wsReplaceP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.systemPrompt.replace.${workspaceId}` }) : Promise.resolve(null);
        const wsTextP = workspaceId ? (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: `agent.systemPrompt.text.${workspaceId}` }) : Promise.resolve(null);
        const [gReplace, gText, wReplace, wText] = await Promise.all([globalReplaceP, globalTextP, wsReplaceP, wsTextP] as const);
        if (!mounted) return;
        const grRaw = typeof gReplace?.data === 'boolean' ? gReplace.data : false;
        const gtRaw = typeof gText?.data === 'string' ? gText.data : '';
        const wrRaw = typeof (wReplace as any)?.data === 'boolean' ? (wReplace as any).data : false;
        const wtRaw = typeof (wText as any)?.data === 'string' ? (wText as any).data : '';
        setSpGlobalReplace(Boolean(grRaw));
        setSpGlobalText(typeof gtRaw === 'string' ? gtRaw : '');
        setSpWorkspaceReplace(Boolean(wrRaw));
        setSpWorkspaceText(typeof wtRaw === 'string' ? wtRaw : '');
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [isOpen, workspaceId]);

  // Derived counts and warnings per prompt
  const spGlobalCharCount = spGlobalText.length;
  const spGlobalTokenCount = useMemo<number>(() => estimateTokenCount(spGlobalText), [spGlobalText]);
  const spWorkspaceCharCount = spWorkspaceText.length;
  const spWorkspaceTokenCount = useMemo<number>(() => estimateTokenCount(spWorkspaceText), [spWorkspaceText]);
  // No combined warning for prompts; individual sizes are shown next to editors.

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
                  <label>
                    <input type="checkbox" checked={execCtxGlobalEnabled} onChange={(e) => setExecCtxGlobalEnabled(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Include System Execution Context (Global)</span>
                  </label>
                  <div className="help" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Adds a short, automatic snapshot to the system prompt so the agent understands your environment (paths, OS, shell, time).
                    <div style={{ marginTop: 4 }}>Example:</div>
                    <pre style={{ margin: '6px 0 0', padding: 6, background: 'var(--surface-muted)', borderRadius: 4, fontSize: 11 }}>
- Working Directory: /your/project
- Home Directory: /Users/you
- Platform: darwin (arm64)
- Shell: zsh 5.9
- Timestamp: 2025-09-10T12:34:56.789Z
                    </pre>
                  </div>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={execCtxWorkspaceEnabled} onChange={(e) => setExecCtxWorkspaceEnabled(e.target.checked)} disabled={!workspaceId} />
                    <span style={{ marginLeft: 6 }}>Include System Execution Context (Workspace)</span>
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

            {/* System Prompts section */}
            <section className="settings-section">
              <div className="field">
                <div className="field-label-row">
                  <label>Global System Prompt</label>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>
                      <input type="checkbox" checked={spGlobalReplace} onChange={(e) => setSpGlobalReplace(e.target.checked)} />
                      <span style={{ marginLeft: 6 }}>Use only this prompt</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="system-prompt-text-global">Global prompt</label>
                <div className="help" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Leave empty to skip. When not replacing, Global and Workspace prompts are combined.
                </div>
                <textarea
                  id="system-prompt-text-global"
                  className="prompt-content-input"
                  value={spGlobalText}
                  onChange={(e) => { setSpGlobalText(e.target.value); }}
                  rows={8}
                  placeholder=""
                />
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {spGlobalCharCount.toLocaleString()} chars · ~{spGlobalTokenCount.toLocaleString()} tokens
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={async () => {
                      try {
                        const toCopy = spGlobalText;
                        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(toCopy);
                        else {
                          const ta = document.createElement('textarea');
                          ta.value = toCopy; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                        }
                      } catch { /* ignore */ }
                    }} title="Copy global system prompt">
                      <Copy size={14} /> Copy
                    </button>
                    <button className="cancel-button" onClick={() => { setSpGlobalMode('default'); setSpGlobalText(''); }} title="Reset global to default">
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <div className="field-label-row">
                  <label>Workspace System Prompt</label>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>
                      <input type="checkbox" checked={spWorkspaceReplace} onChange={(e) => setSpWorkspaceReplace(e.target.checked)} disabled={!workspaceId} />
                      <span style={{ marginLeft: 6 }}>Use only this prompt</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="system-prompt-text-workspace">Workspace prompt</label>
                <div className="help" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Applies only to the active workspace. Typing here switches Mode to Override.
                </div>
                <textarea
                  id="system-prompt-text-workspace"
                  className="prompt-content-input"
                  value={spWorkspaceText}
                  onChange={(e) => { setSpWorkspaceText(e.target.value); }}
                  rows={8}
                  placeholder={workspaceId ? '' : 'Open a workspace to edit its prompt'}
                  disabled={!workspaceId}
                />
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {spWorkspaceCharCount.toLocaleString()} chars · ~{spWorkspaceTokenCount.toLocaleString()} tokens
                  </div>
                  <div className="actions">
                    <button className="secondary" disabled={!workspaceId} onClick={async () => {
                      try {
                        const toCopy = spWorkspaceText;
                        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(toCopy);
                        else {
                          const ta = document.createElement('textarea');
                          ta.value = toCopy; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                        }
                      } catch { /* ignore */ }
                    }} title="Copy workspace system prompt">
                      <Copy size={14} /> Copy
                    </button>
                    <button className="cancel-button" disabled={!workspaceId} onClick={() => { setSpWorkspaceReplace(false); setSpWorkspaceText(''); }} title="Reset workspace to default">
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              {/* Notes: The automatic summary has been removed. Execution context may be appended if enabled. */}
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
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.executionContext.enabled', value: execCtxGlobalEnabled });
                if (workspaceId) {
                  await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.executionContext.enabled.${workspaceId}`, value: execCtxWorkspaceEnabled });
                }
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.approvalMode', value: approvalMode });
                // System prompts: save global and workspace separately
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.systemPrompt.replace', value: spGlobalReplace });
                await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.systemPrompt.text', value: spGlobalText });
                if (workspaceId) {
                  await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.systemPrompt.replace.${workspaceId}`, value: spWorkspaceReplace });
                  await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: `agent.systemPrompt.text.${workspaceId}`, value: spWorkspaceText });
                }
                setStatus('success'); setTimeout(() => setStatus('idle'), 1000);
              } catch (e) { setStatus('error'); setError((e as Error)?.message || 'Failed to save'); }
            }}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
