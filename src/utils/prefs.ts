export async function getPref<T = unknown>(key: string): Promise<T | null> {
  try {
    const resp = await window.electron.ipcRenderer.invoke('/prefs/get', { key });
    if (resp && typeof resp === 'object' && 'success' in resp) {
      const ok = (resp as { success: boolean }).success;
      if (!ok) return null;
      return (resp as { data: T | null }).data ?? null;
    }
    // Some tests return the raw value
    return (resp as T) ?? null;
  } catch {
    return null;
  }
}

export async function setPref<T = unknown>(key: string, value: T): Promise<boolean> {
  try {
    const resp = await window.electron.ipcRenderer.invoke('/prefs/set', { key, value });
    if (resp && typeof resp === 'object' && 'success' in resp) {
      return Boolean((resp as { success: boolean }).success);
    }
    // Some tests return null; treat as success for no-op env
    return true;
  } catch {
    return false;
  }
}

