import { useEffect, useMemo, useState } from "react";
import Dropdown from "./dropdown";
import "./model-selector.css";

type ProviderId = "openai" | "anthropic" | "openrouter";

type CatalogModel = {
  id: string;
  label: string;
  contextWindowTokens?: number;
  costTier?: string;
  supportsTools?: boolean;
};

export function ModelSelector({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [reasoningEffort, setReasoningEffort] = useState<string>("high");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // API info from preload
  function useApiInfo() {
    const info = window.__PF_API_INFO ?? {};
    const apiBase = typeof info.apiBase === "string" && info.apiBase ? info.apiBase : "http://localhost:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }
  const { apiBase, authToken } = useApiInfo();

  // Minimal static fallback catalog to ensure models are selectable even if the API list fails (e.g., auth race on startup)
  const STATIC_FALLBACK: Record<ProviderId, CatalogModel[]> = {
    openai: [
      { id: "gpt-5", label: "GPT-5", supportsTools: true },
      { id: "gpt-5-mini", label: "GPT-5 Mini", supportsTools: true },
      { id: "gpt-5-nano", label: "GPT-5 Nano", supportsTools: true },
      { id: "gpt-4o-mini", label: "GPT-4o Mini (fallback)", supportsTools: true },
      { id: "gpt-5-chat-latest", label: "GPT-5 Chat (router)", supportsTools: true },
    ],
    anthropic: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025-05-14)", supportsTools: true },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (2024-10-22)", supportsTools: true },
    ],
    openrouter: [
      { id: "openai/gpt-5", label: "OpenRouter • OpenAI GPT-5", supportsTools: true },
      { id: "openai/gpt-4o-mini", label: "OpenRouter • OpenAI GPT-4o Mini", supportsTools: true },
      { id: "anthropic/claude-sonnet-4-20250514", label: "OpenRouter • Claude Sonnet 4", supportsTools: true },
    ],
  };

  // Load current provider/model from prefs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const p: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' });
        const m: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' });
        const e: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.reasoningEffort' });
        const pv = (p && typeof p === 'object' && 'success' in p && (p as { success: boolean }).success === true) ? (p as { data?: unknown }).data : null;
        const mv = (m && typeof m === 'object' && 'success' in m && (m as { success: boolean }).success === true) ? (m as { data?: unknown }).data : null;
        const ev = (e && typeof e === 'object' && 'success' in e && (e as { success: boolean }).success === true) ? (e as { data?: unknown }).data : null;
        if (!mounted) return;
        if (typeof pv === 'string' && (pv === 'openai' || pv === 'anthropic' || pv === 'openrouter')) setProvider(pv);
        if (typeof mv === 'string' && mv.trim()) setModel(mv);
        if (typeof ev === 'string' && ev.trim()) setReasoningEffort(ev);
        else setReasoningEffort('high');
      } catch { /* noop */ }
    })();
    return () => { mounted = false; };
  }, []);

  // Fetch models for current provider
  async function fetchModels(prov: ProviderId) {
    setLoading(true);
    try {
      const url = `${apiBase}/api/v1/models?provider=${encodeURIComponent(prov)}`;
      const res = await fetch(url, { headers: { Authorization: authToken ? `Bearer ${authToken}` : '' } });
      if (!res.ok) {
        setModels(STATIC_FALLBACK[prov] || []);
        return;
      }
      const json = await res.json();
      const data = json?.data || json; // server returns ok({ ... })
      const list = Array.isArray(data?.models) ? data.models : [];
      setModels(list.length > 0 ? list : (STATIC_FALLBACK[prov] || []));
    } catch {
      setModels(STATIC_FALLBACK[prov] || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchModels(provider);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, apiBase, authToken]);

  const providerOptions = useMemo(() => ([
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openrouter', label: 'OpenRouter' },
  ]), []);

  const modelOptions = useMemo(() => models.map(m => ({ value: m.id, label: m.label || m.id })), [models]);

  // Heuristic: show reasoning effort when current model is reasoning-capable
  const isReasoningModel = useMemo(() => {
    try {
      const s = String(model || '').toLowerCase();
      return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
    } catch { return false; }
  }, [model]);

  async function updateProvider(next: ProviderId) {
    try {
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: next });
      setProvider(next);
      // Inform user that model applies on next turn implicitly
    } catch { /* ignore */ }
  }

  async function updateModel(next: string) {
    try {
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.defaultModel', value: next });
      setModel(next);
    } catch { /* ignore */ }
  }

  async function updateReasoningEffort(next: string) {
    try {
      const normalized = ['minimal','low','medium','high'].includes(next) ? next : 'high';
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.reasoningEffort', value: normalized });
      setReasoningEffort(normalized);
    } catch { /* ignore */ }
  }

  return (
    <div className="model-selector-compact" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ minWidth: 130 }}>
        <Dropdown
          options={providerOptions}
          value={provider}
          onChange={(v: unknown) => updateProvider(String(v) as ProviderId)}
          buttonLabel={`Provider: ${providerOptions.find(o => o.value === provider)?.label ?? provider}`}
          position="left"
          placement="top"
          variant="minimal"
        />
      </div>
      <div style={{ minWidth: 220 }}>
        <Dropdown
          options={modelOptions}
          value={model}
          onChange={(v: unknown) => updateModel(String(v))}
          buttonLabel={loading ? 'Loading models…' : (modelOptions.find(o => o.value === model)?.label ?? 'Select Model')}
          position="left"
          placement="top"
          variant="minimal"
        />
      </div>
      {isReasoningModel && (
        <div style={{ minWidth: 180 }}>
          <Dropdown
            options={[
              { value: 'minimal', label: 'Effort: Minimal' },
              { value: 'low', label: 'Effort: Low' },
              { value: 'medium', label: 'Effort: Medium' },
              { value: 'high', label: 'Effort: High' },
            ]}
            value={reasoningEffort}
            onChange={(v: unknown) => updateReasoningEffort(String(v))}
            buttonLabel={`Effort: ${String(reasoningEffort || 'high')[0].toUpperCase()}${String(reasoningEffort || 'high').slice(1)}`}
            position="left"
            placement="top"
            variant="minimal"
          />
        </div>
      )}
    </div>
  );
}

export default ModelSelector;
