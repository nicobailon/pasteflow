import { useEffect, useState } from "react";
import { getPref, setPref } from "../utils/prefs";

interface AgentSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function AgentSettingsModal({ open, onClose }: AgentSettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      const existing = await getPref<string>("agent.openai.apiKey");
      if (mounted) setApiKey(existing || "");
    })();
    return () => { mounted = false; };
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const ok = await setPref("agent.openai.apiKey", apiKey.trim());
      if (!ok) throw new Error("Failed to save preference");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="agent-settings-modal" role="dialog" aria-modal="true" aria-label="Agent Settings" style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>Agent Settings</strong>
          <button type="button" onClick={onClose} aria-label="Close" style={iconBtn}>&times;</button>
        </div>
        <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>OpenAI API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", marginBottom: 8 }}
        />
        {error && <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={btn}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || apiKey.trim().length === 0} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
};
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', minWidth: 380, maxWidth: 520, padding: 12,
};
const btn: React.CSSProperties = { padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' };
const primaryBtn: React.CSSProperties = { ...btn, background: '#111827', color: '#fff', borderColor: '#111827' };
const iconBtn: React.CSSProperties = { background: 'transparent', border: 0, fontSize: 18, lineHeight: 1, cursor: 'pointer' };

export default AgentSettingsModal;

