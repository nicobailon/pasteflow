import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Dropdown from "./dropdown";
import type { DropdownOption, DropdownRef } from "./dropdown";
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

export function ModelSelector({ onOpenSettings }: { onOpenSettings?: (tab?: ProviderId) => void }) {
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [reasoningEffort, setReasoningEffort] = useState<string>("high");
  const [models, setModels] = useState<UnifiedModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  // Track last provider we persisted to prefs to avoid redundant writes
  const lastProviderRef = useRef<ProviderId | null>(null);
  // Control dropdown programmatically (e.g., close on disabled click)
  const dropdownRef = useRef<DropdownRef>(null);

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
      { id: "openai/gpt-5", label: "GPT-5", supportsTools: true, maxOutputTokens: 128_000 },
      { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", supportsTools: true, maxOutputTokens: 16_384 },
      { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", supportsTools: true, maxOutputTokens: 128_000 },
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
      const hasSecret = (raw: unknown): boolean => {
        try {
          const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
          const val = isObj(raw) && 'success' in raw ? (raw as any).data : raw;
          if (typeof val === 'string') return val.trim().length > 0;
          if (isObj(val)) return (val as any).__type === 'secret' && (val as any).v === 1;
          return false;
        } catch { return false; }
      };
      const next: { openai: boolean; anthropic: boolean; openrouter: boolean; groq: boolean } = {
        openai: hasSecret(okey),
        anthropic: hasSecret(akey),
        openrouter: hasSecret(orKey),
        groq: hasSecret(gkey),
      };
      const prev = hasKeyRef.current;
      if (
        prev.openai !== next.openai ||
        prev.anthropic !== next.anthropic ||
        prev.openrouter !== next.openrouter ||
        prev.groq !== next.groq
      ) {
        setHasKey(next);
      }
    } catch {
      const prev = hasKeyRef.current;
      const next = { openai: false, anthropic: false, openrouter: false, groq: false };
      if (
        prev.openai !== next.openai ||
        prev.anthropic !== next.anthropic ||
        prev.openrouter !== next.openrouter ||
        prev.groq !== next.groq
      ) {
        setHasKey(next);
      }
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

  const ALL_PROVIDERS: ProviderId[] = ["openai", "anthropic", "openrouter", "groq"];

  // Fetch models for providers (fetch for those with keys; fallback for others) and unify
  async function fetchUnifiedModels(keys: { openai: boolean; anthropic: boolean; openrouter: boolean; groq: boolean }) {
    setLoading(true);
    try {
      const results = await Promise.all(ALL_PROVIDERS.map(async (prov) => {
        try {
          if (keys[prov]) {
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
          }
          // No key for this provider: use static fallback (disabled in UI)
          const fallback = (STATIC_FALLBACK[prov] || []).map((m) => ({ ...m, provider: prov } as UnifiedModel));
          return fallback;
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

  // Recompute models whenever provider keys change
  useEffect(() => {
    void fetchUnifiedModels(hasKeyRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  const modelOptions: DropdownOption[] = useMemo(() => {
    const enabled: DropdownOption[] = models
      .filter(m => hasKey[m.provider])
      .map(m => ({ value: m.id, label: (m.label || m.id), disabled: false }));
    const disabled: DropdownOption[] = models
      .filter(m => !hasKey[m.provider])
      .map(m => ({ 
        value: m.id,
        label: (m.label || m.id),
        disabled: true,
        onDisabledClick: () => { try { dropdownRef.current?.close(); } catch { /* noop */ } if (onOpenSettings) onOpenSettings(m.provider); }
      }));
    enabled.sort((a, b) => a.label.localeCompare(b.label));
    disabled.sort((a, b) => a.label.localeCompare(b.label));
    // Insert a visual divider if both groups exist
    const list: DropdownOption[] = [...enabled];
    if (enabled.length > 0 && disabled.length > 0) {
      list.push({ value: '__divider__', label: '', disabled: true, className: 'dropdown-divider' });
    }
    list.push(...disabled);
    return list;
  }, [models, hasKey]);

  const renderModelOption = useCallback((option: DropdownOption, isActive: boolean) => {
    return (
      <>
        <span style={{ opacity: option.disabled ? 0.6 : 1, color: option.disabled ? 'var(--text-secondary)' : 'inherit' }}>{option.label}</span>
        {option.disabled && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>Configure Keys</span>
        )}
        {isActive && !option.disabled && (<span style={{ marginLeft: 'auto' }}>✓</span>)}
      </>
    );
  }, []);

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
    if (!prov || prov === lastProviderRef.current) return;
    lastProviderRef.current = prov;
    (async () => {
      try { await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: prov }); } catch { /* noop */ }
    })();
  }, [model, providerForModel]);

  async function updateModel(next: string) {
    try {
      const prov = providerForModel.get(next);
      if (prov && !hasKeyRef.current[prov]) {
        // Prevent selecting models for providers without configured keys; open settings on that tab
        try { dropdownRef.current?.close(); } catch { /* noop */ }
        if (onOpenSettings) onOpenSettings(prov);
        return;
      }
      await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.defaultModel', value: next });
      setModel(next);
      if (prov) {
        if (prov !== lastProviderRef.current) {
          lastProviderRef.current = prov;
          await window.electron?.ipcRenderer?.invoke?.('/prefs/set', { key: 'agent.provider', value: prov });
        }
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
    <div className="model-selector-compact" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {modelOptions.length > 0 ? (
        <div>
          <Dropdown
            ref={dropdownRef}
            options={modelOptions}
            value={model}
            onChange={(v: unknown) => updateModel(String(v))}
            buttonLabel={
              modelOptions.find(o => o.value === model)?.label
              ?? (loading ? 'Loading models…' : 'Select Model')
            }
            position="left"
            placement="top"
            variant="minimal"
            renderCustomOption={renderModelOption}
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
        <div>
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
