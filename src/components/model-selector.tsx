import { useEffect, useMemo, useRef, useState } from "react";

import Dropdown from "./dropdown";
import "./model-selector.css";

type ProviderId = "openai" | "anthropic" | "openrouter" | "groq";

type CatalogModel = {
  id: string;
  label: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  costTier?: string;
  supportsTools?: boolean;
};

type UnifiedModel = CatalogModel & { provider: ProviderId };

function getApiInfo() {
  const info = window.__PF_API_INFO ?? {};
  const apiBase = typeof info.apiBase === "string" && info.apiBase ? info.apiBase : "http://localhost:5839";
  const authToken = typeof info.authToken === "string" ? info.authToken : "";
  return { apiBase, authToken };
}

export function ModelSelector({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [reasoningEffort, setReasoningEffort] = useState<string>("high");
  const [models, setModels] = useState<UnifiedModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // API info from preload
  const { apiBase, authToken } = getApiInfo();

  // Track configured providers via stored API keys
  const [hasKey, setHasKey] = useState<{ openai: boolean; anthropic: boolean; openrouter: boolean; groq: boolean }>({ openai: false, anthropic: false, openrouter: false, groq: false });
  const hasKeyRef = useRef(hasKey);
  useEffect(() => { hasKeyRef.current = hasKey; }, [hasKey]);

  // Minimal static fallback catalog to ensure models are selectable if API list fails
  const STATIC_FALLBACK: Record<ProviderId, CatalogModel[]> = {
    openai: [
      { id: "gpt-5", label: "GPT-5", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "gpt-5-mini", label: "GPT-5 Mini", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "gpt-5-nano", label: "GPT-5 Nano", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "gpt-4o-mini", label: "GPT-4o Mini (fallback)", supportsTools: true, maxOutputTokens: 16_384 },
      { id: "gpt-5-chat-latest", label: "GPT-5 Chat (router)", supportsTools: true, maxOutputTokens: 128_000 },
    ],
    anthropic: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025-05-14)", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (2024-10-22)", supportsTools: true, maxOutputTokens: 8192 },
    ],
    openrouter: [
      { id: "openai/gpt-5", label: "OpenRouter • OpenAI GPT-5", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "openai/gpt-4o-mini", label: "OpenRouter • OpenAI GPT-4o Mini", supportsTools: true, maxOutputTokens: 16_384 },
      { id: "anthropic/claude-sonnet-4-20250514", label: "OpenRouter • Claude Sonnet 4", supportsTools: true, maxOutputTokens: 128_000 },
    ],
    groq: [
      { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 0905", supportsTools: true, maxOutputTokens: 16_384 },
    ],
  };

  // Load current model/effort from prefs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.defaultModel' });
        const e: unknown = await window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'agent.reasoningEffort' });
        const mv = (m && typeof m === 'object' && 'success' in m && (m as { success: boolean }).success === true) ? (m as { data?: unknown }).data : null;
        const ev = (e && typeof e === 'object' && 'success' in e && (e as { success: boolean }).success === true) ? (e as { data?: unknown }).data : null;
        if (!mounted) return;
        if (typeof mv === 'string' && mv.trim()) setModel(mv);
        if (typeof ev === 'string' && ev.trim()) setReasoningEffort(ev);
        else setReasoningEffort('high');
      } catch { /* noop */ }
    })();
    return () => { mounted = false; };
  }, []);

  // Determine configured providers based on stored keys
  const refreshConfiguredProviders = async () => {
    try {
      const [okey, akey, orKey, gkey] = await Promise.all([
        window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openai.apiKey' }),
        window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.anthropic.apiKey' }),
        window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.openrouter.apiKey' }),
        window.electron?.ipcRenderer?.invoke?.('/prefs/get', { key: 'integrations.groq.apiKey' }),
      ]);
      const bool = (v: unknown) => Boolean((v as any)?.data ?? v);
      setHasKey({ openai: bool(okey), anthropic: bool(akey), openrouter: bool(orKey), groq: bool(gkey) });
    } catch {
      setHasKey({ openai: false, anthropic: false, openrouter: false, groq: false });
    }
  };

  useEffect(() => {
    void refreshConfiguredProviders();
    const cb = () => { void refreshConfiguredProviders(); };
    try {
      (window as any).electron?.ipcRenderer?.on?.('/prefs/get:update', cb);
    } catch { /* noop */ }
    return () => {
      try { (window as any).electron?.ipcRenderer?.removeListener?.('/prefs/get:update', cb); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch models for enabled providers and unify
  async function fetchUnifiedModels(enabled: ProviderId[]) {
    setLoading(true);
    try {
      const results = await Promise.all(enabled.map(async (prov) => {
        try {
          const url = `${apiBase}/api/v1/models?provider=${encodeURIComponent(prov)}`;
          const res = await fetch(url, { headers: { Authorization: authToken ? `Bearer ${authToken}` : '' } });
          if (!res.ok) {
            const fallback = (STATIC_FALLBACK[prov] || []).map((m) => ({ ...m, provider: prov } as UnifiedModel));
            return fallback;
          }
          const json = await res.json();
          const data = json?.data || json;
          const list: CatalogModel[] = Array.isArray(data?.models) ? data.models : [];
          const annotated = (list.length > 0 ? list : (STATIC_FALLBACK[prov] || [])).map((m) => ({ ...m, provider: prov } as UnifiedModel));
          return annotated;
        } catch {
          const fallback = (STATIC_FALLBACK[prov] || []).map((m) => ({ ...m, provider: prov } as UnifiedModel));
          return fallback;
        }
      }));
      const flat = results.flat();
      // Stable sort by provider name then label
      flat.sort((a, b) => (a.provider === b.provider ? (a.label || a.id).localeCompare(b.label || b.id) : a.provider.localeCompare(b.provider)));
      setModels(flat);
    } finally {
      setLoading(false);
    }
  }

  // Recompute enabled providers list and fetch models whenever keys change
  useEffect(() => {
    const enabled: ProviderId[] = (Object.entries(hasKeyRef.current).filter(([, v]) => v) as Array<[string, boolean]>).map(([k]) => k as ProviderId);
    if (enabled.length === 0) { setModels([]); return; }
    void fetchUnifiedModels(enabled);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  const modelOptions = useMemo(() => models.map(m => ({ value: m.id, label: `${m.label || m.id} • ${m.provider}` })), [models]);

  // Heuristic: show reasoning effort when current model is reasoning-capable
  const isReasoningModel = useMemo(() => {
    try {
      const s = String(model || '').toLowerCase();
      return !!s && (s.includes('o1') || s.includes('o3') || (s.includes('gpt-5') && !s.includes('chat')));
    } catch { return false; }
  }, [model]);

  // Map a model id to its provider from current list
  const providerForModel = useMemo(() => {
    const map = new Map<string, ProviderId>();
    for (const m of models) map.set(m.id, m.provider);
    return map;
  }, [models]);

  // Keep provider preference consistent with selected model when possible
  useEffect(() => {
    const prov = providerForModel.get(model);
    if (!prov) return;
    (async () => {
      try { await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: prov }); } catch { /* noop */ }
    })();
  }, [model, providerForModel]);

  async function updateModel(next: string) {
    try {
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.defaultModel', value: next });
      setModel(next);
      const prov = providerForModel.get(next);
      if (prov) {
        await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: prov });
      }
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
      {modelOptions.length > 0 ? (
        <div style={{ minWidth: 260 }}>
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
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            No providers configured. Add an API key to use models.
          </span>
          {onOpenSettings && (
            <button className="secondary" onClick={() => onOpenSettings()} style={{ padding: '4px 8px' }}>
              Configure Keys
            </button>
          )}
        </div>
      )}
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
