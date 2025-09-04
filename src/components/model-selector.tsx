import { useEffect, useMemo, useState } from "react";
import Dropdown from "./dropdown";

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
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // API info from preload
  function useApiInfo() {
    const info = (window as any).__PF_API_INFO || {};
    const apiBase = typeof info.apiBase === "string" ? info.apiBase : "http://127.0.0.1:5839";
    const authToken = typeof info.authToken === "string" ? info.authToken : "";
    return { apiBase, authToken };
  }
  const { apiBase, authToken } = useApiInfo();

  // Load current provider/model from prefs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const p = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.provider' });
        const m = await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' });
        const pv = (p && p.success) ? p.data : null;
        const mv = (m && m.success) ? m.data : null;
        if (!mounted) return;
        if (typeof pv === 'string' && (pv === 'openai' || pv === 'anthropic' || pv === 'openrouter')) setProvider(pv);
        if (typeof mv === 'string' && mv.trim()) setModel(mv);
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
      const json = await res.json();
      const data = json?.data || json; // server returns ok({ ... })
      const list = Array.isArray(data?.models) ? data.models : [];
      setModels(list);
    } catch {
      setModels([]);
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

  async function updateProvider(next: ProviderId) {
    try {
      await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: next });
      setProvider(next);
      // Inform user that model applies on next turn implicitly
    } catch { /* ignore */ }
  }

  async function updateModel(next: string) {
    try {
      await (window as any).electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.defaultModel', value: next });
      setModel(next);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ minWidth: 130 }}>
        <Dropdown
          options={providerOptions}
          value={provider}
          onChange={(v: any) => updateProvider(v as ProviderId)}
          buttonLabel={`Provider: ${providerOptions.find(o => o.value === provider)?.label ?? provider}`}
          position="left"
          placement="top"
        />
      </div>
      <div style={{ minWidth: 220 }}>
        <Dropdown
          options={modelOptions}
          value={model}
          onChange={(v: any) => updateModel(v as string)}
          buttonLabel={loading ? 'Loading models…' : (modelOptions.find(o => o.value === model)?.label ?? 'Select Model')}
          position="left"
          placement="top"
        />
      </div>
      <button className="secondary" onClick={() => onOpenSettings?.()} title="Model settings">Settings</button>
    </div>
  );
}

export default ModelSelector;
